import { materializeContextCandidates, queryContextCandidates } from './context-runtime/postgres-index';
import type { ContextPlanningInput } from './context-runtime/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { resolve } from 'node:path';
import type { ExecutionRun, RunMutation, RunTrace } from './execution-runtime/run';
import { semanticStateChecksum } from './infrastructure/workspace-semantic-checksum';
import type { Anchor, AuditEvent, ContextManifest, DiscussionEdge, DiscussionNode, FileChunk, Resource, ResourceMaterialization, ResourceVersion, Segment, StoredAttachment, StoredMessage, WorkspaceData } from './domain';
import { createSeedWorkspace } from './seed';
import { validateWorkspaceHistoryUpdate, type WorkspaceRepository, type WorkspaceUpdateOptions } from './store';
import type { WorkspaceDirectoryPort } from './identity/workspace-directory';
import { DOMAIN_EVENT_SCHEMA_VERSION, workspaceSemanticChanges, workspaceSemanticSnapshot, type CommandFactContext, type CommandReceipt, type DomainEventEnvelope } from './domain-journal';
import { semanticChecksum } from './infrastructure/workspace-semantic-checksum';
import type { TransactionalWorkspaceCommand, TransactionalWorkspaceCommandResult } from './store';
import type { WorkspaceLifecycleCommand } from './application/ports/workspace-unit-of-work';
import type { WorkspaceRecord } from './contracts/application';
import { buildWorkspaceGraphProjection } from './graph-projection/model';
import { PostgresGraphProjectionAdapter } from './graph-projection/postgres-adapter';
import { deriveProvenance, type ProvenanceLink } from './provenance/model';
import type { PortableWorkspaceFacts } from './application/ports/portable-workspace';
import type { BundleImportCheckpoint } from './application/ports/bundle-import';
import { validatePortableReferences } from './application/portable-references';
import { validatePortableHistory } from './application/portable-history';
import { SqlBundleImportCheckpoints } from './infrastructure/bundle-import-checkpoints';
import { SealedReceiptContent, type SealedReceiptRef } from './infrastructure/sealed-receipt-content';
import { SealedRunContent, type SealedRunInputRef } from './infrastructure/sealed-run-content';
import { SealedJournalContent, type SealedJournalRef } from './infrastructure/sealed-journal-content';
import { SealedMessageContent, type SealedMessageRef } from './infrastructure/sealed-message-content';

interface QueryResult<Row> { rows: Row[] }
type PendingContent = { workspaceId: string; commandId: string; reference: SealedReceiptRef; kind?: 'result' | 'error' }
  | { workspaceId: string; runId: string; reference: SealedRunInputRef }
  | { workspaceId: string; eventId: string; reference: SealedJournalRef }
  | { workspaceId: string; messageId: string; reference: SealedMessageRef };
export interface SqlQueryable {
  query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>;
}
interface TransactionalSql extends SqlQueryable {
  transaction?<T>(callback: (transaction: SqlQueryable) => Promise<T>): Promise<T>;
  connect?(): Promise<SqlQueryable & { release(): void }>;
  end?(): Promise<void>;
  close?(): Promise<void>;
}

const DEFAULT_PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const asIso = (value: unknown) => value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
const asJson = <T>(value: unknown): T => typeof value === 'string' ? JSON.parse(value) as T : value as T;
function storedJournalEvent(row: Record<string, unknown>): DomainEventEnvelope {
  return {
    eventId: String(row.event_id), workspaceId: String(row.workspace_id), sequence: Number(row.sequence),
    eventType: String(row.event_type) as DomainEventEnvelope['eventType'], ceSpecversion: '1.0', envelopeVersion: DOMAIN_EVENT_SCHEMA_VERSION,
    eventSource: String(row.event_source), subject: String(row.subject), dataSchema: String(row.data_schema),
    aggregateType: String(row.aggregate_type), aggregateId: String(row.aggregate_id), aggregateRevision: Number(row.aggregate_revision), actor: asJson(row.actor_ref), scope: asJson(row.scope_ref),
    commandId: String(row.command_id), eventIndex: Number(row.event_index), causationId: row.causation_id ? String(row.causation_id) : undefined, correlationId: row.correlation_id ? String(row.correlation_id) : undefined,
    payload: asJson(row.payload), occurredAt: asIso(row.occurred_at), recordedAt: asIso(row.recorded_at),
  };
}
function storedMessage(row: Record<string, unknown>, attachmentIds: string[]): StoredMessage {
  return { id: String(row.id), nodeId: String(row.node_id), segmentId: row.segment_id ? String(row.segment_id) : undefined, kind: row.kind as StoredMessage['kind'], text: String(row.body), manifestId: row.manifest_id ? String(row.manifest_id) : undefined, createdAt: asIso(row.created_at), operation: row.operation as StoredMessage['operation'], sourceMessageId: row.source_message_id ? String(row.source_message_id) : undefined, versionGroupId: row.version_group_id ? String(row.version_group_id) : undefined, version: Number(row.version), replyToMessageId: row.reply_to_message_id ? String(row.reply_to_message_id) : undefined, usage: row.usage ? asJson(row.usage) : undefined, reasoning: row.reasoning ? String(row.reasoning) : undefined, toolCalls: row.tool_calls ? asJson(row.tool_calls) : undefined, attachmentIds };
}

function storedAttachment(row: Record<string, unknown>): StoredAttachment {
  return { id: String(row.id), name: String(row.name), mimeType: String(row.mime_type), size: Number(row.size_bytes), kind: row.kind as StoredAttachment['kind'], extractedText: row.extracted_text ? String(row.extracted_text) : undefined, summary: row.summary ? String(row.summary) : undefined, chunkCount: row.chunk_count === null ? undefined : Number(row.chunk_count), resourceId: row.resource_id ? String(row.resource_id) : undefined, resourceVersionId: row.resource_version_id ? String(row.resource_version_id) : undefined, digest: row.digest ? String(row.digest) : undefined, blobRef: row.blob_ref ? String(row.blob_ref) : undefined, createdAt: asIso(row.created_at) };
}

function storedResourceVersion(row: Record<string, unknown>): ResourceVersion {
  return { id: String(row.resource_version_id), resourceId: String(row.resource_id), version: Number(row.version), digestAlgorithm: row.digest_algorithm as ResourceVersion['digestAlgorithm'], digest: String(row.digest), canonicalization: row.canonicalization as ResourceVersion['canonicalization'], mediaType: String(row.media_type), size: Number(row.size_bytes), blobRef: String(row.blob_ref), createdAt: asIso(row.created_at) };
}

const relationFromDb = (value: string): DiscussionEdge['relation'] => value.toLowerCase().replaceAll('_', '-') as DiscussionEdge['relation'];
const relationToDb = (value: DiscussionEdge['relation']) => value.toUpperCase().replaceAll('-', '_');
const journalSource = (workspaceId: string) => `urn:rhiza:workspace:${workspaceId}`;
const journalSubject = (aggregateType: string, aggregateId: string) => `${aggregateType}/${aggregateId}`;
const journalDataSchema = (eventType: string) => `https://rhiza.dev/schemas/events/${eventType}/v1`;
const changedItems = <T extends { id: string }>(items: T[], previous?: T[]): T[] => {
  if (!previous) return items;
  const before = new Map(previous.map(item => [item.id, JSON.stringify(item)]));
  return items.filter(item => before.get(item.id) !== JSON.stringify(item));
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function stableUuid(namespace: string, kind: string, value: string): string {
  if (uuidPattern.test(value)) return value;
  const hex = createHash('sha256').update(`${namespace}:${kind}:${value}`).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

export function relationalizeWorkspace(source: WorkspaceData, projectId: string): WorkspaceData {
  const nodeIds = new Map(source.discussionNodes.map(node => [node.id, stableUuid(projectId, 'node', node.id)]));
  const messageIds = new Map(source.messages.map(message => [message.id, stableUuid(projectId, 'message', message.id)]));
  const segmentIds = new Map(source.segments.map(segment => [segment.id, stableUuid(projectId, 'segment', segment.id)]));
  const anchorIds = new Map(source.anchors.map(anchor => [anchor.id, stableUuid(projectId, 'anchor', anchor.id)]));
  const edgeIds = new Map(source.discussionEdges.map(edge => [edge.id, stableUuid(projectId, 'edge', edge.id)]));
  const manifestIds = new Map(source.manifests.map(manifest => [manifest.id, stableUuid(projectId, 'manifest', manifest.id)]));
  const attachmentIds = new Map(source.attachments.map(attachment => [attachment.id, stableUuid(projectId, 'attachment', attachment.id)]));
  const auditIds = new Map(source.auditEvents.map(event => [event.id, stableUuid(projectId, 'audit', event.id)]));
  const activeNodeId = nodeIds.get(source.activeNodeId) || stableUuid(projectId, 'node', source.activeNodeId);
  const mapSource = (value: string | undefined) => value ? nodeIds.get(value) || segmentIds.get(value) || attachmentIds.get(value) || value : undefined;
  return {
    ...source,
    projectId,
    nodeId: activeNodeId,
    activeNodeId,
    contextItems: source.contextItems.map(item => ({ ...item, sourceId: mapSource(item.sourceId), sourceNodeId: item.sourceNodeId ? nodeIds.get(item.sourceNodeId) || item.sourceNodeId : undefined })),
    discussionNodes: source.discussionNodes.map(node => ({ ...node, id: nodeIds.get(node.id)!, sourceNodeId: node.sourceNodeId ? nodeIds.get(node.sourceNodeId) : undefined, sourceMessageId: node.sourceMessageId ? messageIds.get(node.sourceMessageId) : undefined })),
    messages: source.messages.map(message => ({ ...message, id: messageIds.get(message.id)!, nodeId: nodeIds.get(message.nodeId)!, segmentId: message.segmentId ? segmentIds.get(message.segmentId) : undefined, manifestId: message.manifestId ? manifestIds.get(message.manifestId) : undefined, sourceMessageId: message.sourceMessageId ? messageIds.get(message.sourceMessageId) : undefined, replyToMessageId: message.replyToMessageId ? messageIds.get(message.replyToMessageId) : undefined, attachmentIds: message.attachmentIds?.map(id => attachmentIds.get(id) || id) })),
    segments: source.segments.map(segment => ({ ...segment, id: segmentIds.get(segment.id)!, nodeId: nodeIds.get(segment.nodeId)! })),
    anchors: source.anchors.map(anchor => ({ ...anchor, id: anchorIds.get(anchor.id)!, nodeId: nodeIds.get(anchor.nodeId)!, messageId: anchor.messageId ? messageIds.get(anchor.messageId) : undefined, segmentId: anchor.segmentId ? segmentIds.get(anchor.segmentId) : undefined })),
    discussionEdges: source.discussionEdges.map(edge => ({ ...edge, id: edgeIds.get(edge.id)!, source: nodeIds.get(edge.source)!, target: nodeIds.get(edge.target)!, anchorId: edge.anchorId ? anchorIds.get(edge.anchorId) : undefined })),
    manifests: source.manifests.map(manifest => ({ ...manifest, id: manifestIds.get(manifest.id)!, projectId, nodeId: nodeIds.get(manifest.nodeId)!, requestId: stableUuid(projectId, 'request', manifest.requestId), sourceMessageId: manifest.sourceMessageId ? messageIds.get(manifest.sourceMessageId) : undefined, attachmentIds: manifest.attachmentIds.map(id => attachmentIds.get(id) || id), contextItems: manifest.contextItems.map(item => ({ ...item, sourceId: mapSource(item.sourceId) || item.sourceId, sourceNodeId: item.sourceNodeId ? nodeIds.get(item.sourceNodeId) || item.sourceNodeId : undefined })) })),
    attachments: source.attachments.map(attachment => ({ ...attachment, id: attachmentIds.get(attachment.id)! })),
    fileChunks: source.fileChunks.map(chunk => ({ ...chunk, attachmentId: attachmentIds.get(chunk.attachmentId) || chunk.attachmentId })),
    auditEvents: source.auditEvents.map(event => ({ ...event, id: auditIds.get(event.id)!, projectId, nodeId: event.nodeId ? nodeIds.get(event.nodeId) : undefined, entityId: nodeIds.get(event.entityId) || messageIds.get(event.entityId) || event.entityId })),
  };
}

function relationalSeed(projectId: string): WorkspaceData {
  return relationalizeWorkspace(createSeedWorkspace(), projectId);
}

export class PostgresWorkspaceStore implements WorkspaceRepository {
  private readonly transactionContent = new WeakMap<SqlQueryable, PendingContent[]>();
  get bundleImportCheckpoints() { return new SqlBundleImportCheckpoints(this.database); }
  private runtimeOwner?: SqlQueryable & { release(): void };
  private queue: Promise<void> = Promise.resolve();
  private readonly scoped = new Map<string, PostgresWorkspaceStore>();
  readonly defaultWorkspaceId: string;

  constructor(private readonly database: TransactionalSql, defaultWorkspaceId?: string, private readonly receiptContent?: SealedReceiptContent, private readonly runContent?: SealedRunContent, private readonly journalContent?: SealedJournalContent, private readonly messageContent?: SealedMessageContent) {
    const configuredWorkspaceId = defaultWorkspaceId?.trim();
    if (configuredWorkspaceId && !uuidPattern.test(configuredWorkspaceId)) throw new Error('RHIZA_PROJECT_ID must be a UUID when set');
    this.defaultWorkspaceId = configuredWorkspaceId || DEFAULT_PROJECT_ID;
  }

  forWorkspace(workspaceId: string): WorkspaceRepository {
    if (workspaceId === this.defaultWorkspaceId) return this;
    let scoped = this.scoped.get(workspaceId);
    if (!scoped) { scoped = new PostgresWorkspaceStore(this.database, workspaceId, this.receiptContent, this.runContent, this.journalContent, this.messageContent); this.scoped.set(workspaceId, scoped); }
    return scoped;
  }

  async initialize(workspace: WorkspaceData): Promise<WorkspaceData> {
    const initial = relationalizeWorkspace(workspace, this.defaultWorkspaceId);
    return this.inTransaction(async database => {
      await database.query("SELECT pg_advisory_xact_lock(hashtext('rhiza:workspace:init:' || $1))", [this.defaultWorkspaceId]);
      const existing = await this.readFrom(database, true);
      if (existing?.discussionNodes.length) return existing;
      await this.persist(database, initial);
      return initial;
    });
  }

  readonly workspaceDirectory: WorkspaceDirectoryPort = {
    isOwner: async (userId, workspaceId) => (await this.database.query("SELECT 1 FROM workspace_members WHERE user_id=$1 AND workspace_id=$2 AND role='owner'", [userId, workspaceId])).rows.length > 0,
    listWorkspaces: async (userId, includeArchived = false) => {
      const result = await this.database.query<{ workspace_id: string; name: string; status: 'active' | 'archived'; created_by: string; revision: number }>(`SELECT w.workspace_id,w.name,w.status,w.created_by,COALESCE((w.settings->>'revision')::integer,1) revision FROM workspace_members m JOIN workspaces w ON w.workspace_id=m.workspace_id WHERE m.user_id=$1${includeArchived ? '' : " AND w.status='active'"} ORDER BY w.updated_at DESC`, [userId]);
      return result.rows.map(row => ({ workspaceId: row.workspace_id, name: row.name, status: row.status, createdBy: row.created_by, revision: row.revision }));
    },
    createWorkspace: async record => this.inTransaction(async database => {
      await database.query('INSERT INTO rhiza_projects (id,title,state) VALUES ($1,$2,$3::jsonb) ON CONFLICT (id) DO NOTHING', [record.workspaceId, record.name, '{}']);
      const inserted = await database.query<{ workspace_id: string }>("INSERT INTO workspaces (workspace_id,name,status,created_by,settings) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (workspace_id) DO NOTHING RETURNING workspace_id", [record.workspaceId, record.name, record.status, record.createdBy, JSON.stringify({ revision: record.revision })]);
      if (!inserted.rows[0]) {
        const existing = await database.query<{ workspace_id: string; name: string; status: 'active' | 'archived'; created_by: string; revision: number }>("SELECT workspace_id,name,status,created_by,COALESCE((settings->>'revision')::integer,1) revision FROM workspaces WHERE workspace_id=$1", [record.workspaceId]);
        const value = existing.rows[0]!;
        return { record: { workspaceId: value.workspace_id, name: value.name, status: value.status, createdBy: value.created_by, revision: value.revision }, created: false };
      }
      await database.query("INSERT INTO workspace_members (workspace_id,user_id,role) VALUES ($1,$2,'owner') ON CONFLICT (workspace_id,user_id) DO NOTHING", [record.workspaceId, record.createdBy]);
      return { record, created: true };
    }),
    updateWorkspace: async (record, expectedRevision) => {
      const result = await this.database.query<{ workspace_id: string }>("UPDATE workspaces SET name=$2,status=$3,settings=jsonb_set(settings,'{revision}',to_jsonb($4::int),true),updated_at=now() WHERE workspace_id=$1 AND COALESCE((settings->>'revision')::integer,1)=$5 RETURNING workspace_id", [record.workspaceId, record.name, record.status, record.revision, expectedRevision]);
      return result.rows[0] ? record : undefined;
    },
    ensureWorkspace: async record => this.inTransaction(async database => {
      await database.query("INSERT INTO users (user_id,display_name) VALUES ($1,'Local user') ON CONFLICT (user_id) DO NOTHING", [record.createdBy]);
      await database.query('INSERT INTO rhiza_projects (id,title,state) VALUES ($1,$2,$3::jsonb) ON CONFLICT (id) DO NOTHING', [record.workspaceId, record.name, '{}']);
      const inserted = await database.query<{ workspace_id: string }>("INSERT INTO workspaces (workspace_id,name,status,created_by,settings) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (workspace_id) DO NOTHING RETURNING workspace_id", [record.workspaceId, record.name, record.status, record.createdBy, JSON.stringify({ revision: record.revision })]);
      if (inserted.rows[0]) await database.query("INSERT INTO workspace_members (workspace_id,user_id,role) VALUES ($1,$2,'owner')", [record.workspaceId, record.createdBy]);
      const existing = await database.query<{ workspace_id: string; name: string; status: 'active' | 'archived'; created_by: string; revision: number }>("SELECT workspace_id,name,status,created_by,COALESCE((settings->>'revision')::integer,1) revision FROM workspaces WHERE workspace_id=$1", [record.workspaceId]);
      const value = existing.rows[0]!;
      return { workspaceId: value.workspace_id, name: value.name, status: value.status, createdBy: value.created_by, revision: value.revision };
    }),
  };

  static fromConnectionString(connectionString: string, projectId?: string, contentDirectory = resolve('var/receipt-content')) {
    return new PostgresWorkspaceStore(new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 }), projectId, SealedReceiptContent.atDirectory(contentDirectory), SealedRunContent.atDirectory(resolve(contentDirectory, 'runs')), SealedJournalContent.atDirectory(resolve(contentDirectory, 'journal')), SealedMessageContent.atDirectory(resolve(contentDirectory, 'messages')));
  }

  /** PostgreSQL hosts admit one Chat runtime per database; a second host must not reconcile live work. */
  async acquireRuntimeOwnership(): Promise<void> {
    if (!this.database.connect || this.runtimeOwner) return;
    const client = await this.database.connect();
    try {
      const result = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock(hashtext('rhiza:chat-runtime')) AS acquired");
      if (!result.rows[0]?.acquired) throw new Error('Another Rhiza Chat runtime is active for this database');
      this.runtimeOwner = client;
    } catch (error) { client.release(); throw error; }
  }

  async close(): Promise<void> {
    if (this.runtimeOwner) { await this.runtimeOwner.query("SELECT pg_advisory_unlock(hashtext('rhiza:chat-runtime'))"); this.runtimeOwner.release(); this.runtimeOwner = undefined; }
    if (this.database.end) await this.database.end();
    else if (this.database.close) await this.database.close();
  }

  private async inTransaction<T>(callback: (database: SqlQueryable) => Promise<T>): Promise<T> {
    const pending: PendingContent[] = [];
    let operationFailed = false;
    const operation = async (database: SqlQueryable) => {
      this.transactionContent.set(database, pending);
      try { return await callback(database); }
      catch (error) { operationFailed = true; throw error; }
      finally { this.transactionContent.delete(database); }
    };
    if (this.database.transaction) {
      try { return await this.database.transaction(operation); }
      catch (error) {
        if (operationFailed) await this.discardPendingContent(pending);
        throw error;
      }
    }
    if (!this.database.connect) throw new Error('PostgreSQL adapter does not support transactions');
    const client = await this.database.connect();
    let commitStarted = false;
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      commitStarted = true;
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      // A lost COMMIT response is ambiguous: never destroy potentially live keys.
      if (!commitStarted) await this.discardPendingContent(pending);
      throw error;
    } finally {
      client.release();
    }
  }

  private async discardPendingContent(pending: PendingContent[]) {
    while (pending.length) {
      const item = pending[pending.length - 1];
      if ('runId' in item) await this.runContent!.destroy(item.workspaceId, item.runId, item.reference);
      else if ('eventId' in item) await this.journalContent!.destroy(item.workspaceId, item.eventId, item.reference);
      else if ('messageId' in item) await this.messageContent!.destroy(item.workspaceId, item.messageId, item.reference);
      else await this.receiptContent!.destroy(item.workspaceId, item.commandId, item.reference, item.kind);
      pending.pop();
    }
  }

  private async prepareJournalPayload(database: SqlQueryable, workspaceId: string, eventId: string, payload: Record<string, unknown>) {
    if (!this.journalContent) return { payload: JSON.stringify(payload), reference: null };
    const pending = this.transactionContent.get(database);
    if (!pending) throw new Error('JOURNAL_CONTENT_REQUIRES_TRANSACTION');
    const reference = await this.journalContent.seal(workspaceId, eventId, payload);
    pending.push({ workspaceId, eventId, reference });
    return { payload: JSON.stringify({ sealed: true }), reference: JSON.stringify(reference) };
  }

  private async insertCommittedReceipt(database: SqlQueryable, workspaceId: string, commandId: string, commandType: string, firstSequence: number, lastSequence: number, value: unknown) {
    let reference: SealedReceiptRef | undefined;
    if (this.receiptContent) {
      const pending = this.transactionContent.get(database);
      if (!pending) throw new Error('RECEIPT_CONTENT_REQUIRES_TRANSACTION');
      reference = await this.receiptContent.seal(workspaceId, commandId, value);
      pending.push({ workspaceId, commandId, reference });
    }
    await database.query(`INSERT INTO command_receipts (workspace_id,command_id,command_type,status,first_sequence,last_sequence,result,result_content_ref)
      VALUES ($1,$2,$3,'committed',$4,$5,$6::jsonb,$7::jsonb)`,
    [workspaceId, commandId, commandType, firstSequence, lastSequence, reference ? null : JSON.stringify(value ?? null), reference ? JSON.stringify(reference) : null]);
  }

  async sealLegacyReceiptResults(limit = 100): Promise<number> {
    return this.sealLegacyReceiptField('result', limit);
  }

  /** Maintenance only: scan all workspaces sharing this key store, never a scoped subset. */
  async auditReceiptKeys() {
    if (!this.receiptContent) throw new Error('RECEIPT_CONTENT_STORE_UNAVAILABLE');
    const { rows } = await this.database.query<{ workspace_id: string; command_id: string; result_content_ref: unknown; error_content_ref: unknown }>(
      'SELECT workspace_id,command_id,result_content_ref,error_content_ref FROM command_receipts WHERE result_content_ref IS NOT NULL OR error_content_ref IS NOT NULL');
    const references = rows.flatMap(row => (['result', 'error'] as const).flatMap(kind => {
      const reference = row[`${kind}_content_ref`];
      return reference == null ? [] : [{ workspaceId: row.workspace_id, commandId: row.command_id, reference: asJson<SealedReceiptRef>(reference), kind }];
    }));
    return this.receiptContent.auditKeys(references);
  }

  async sealLegacyReceiptErrors(limit = 100): Promise<number> {
    return this.sealLegacyReceiptField('error', limit);
  }

  private async sealLegacyReceiptField(kind: 'result' | 'error', limit: number): Promise<number> {
    if (!this.receiptContent) throw new Error('RECEIPT_CONTENT_STORE_UNAVAILABLE');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('INVALID_RECEIPT_MIGRATION_LIMIT');
    let migrated = 0;
    while (migrated < limit) {
      const changed = await this.inTransaction(async database => {
        await database.query("SELECT pg_advisory_xact_lock(hashtext('rhiza:workspace-write:' || $1))", [this.defaultWorkspaceId]);
        const selection = kind === 'result'
          ? "SELECT command_id,result AS value FROM command_receipts WHERE workspace_id=$1 AND status='committed' AND result_content_ref IS NULL ORDER BY command_id LIMIT 1 FOR UPDATE"
          : "SELECT command_id,error AS value FROM command_receipts WHERE workspace_id=$1 AND status='rejected' AND error_content_ref IS NULL ORDER BY command_id LIMIT 1 FOR UPDATE";
        const result = await database.query<{ command_id: string; value: unknown }>(selection, [this.defaultWorkspaceId]);
        const row = result.rows[0];
        if (!row) return false;
        const value = asJson(row.value);
        const reference = await this.receiptContent!.seal(this.defaultWorkspaceId, row.command_id, value, kind);
        this.transactionContent.get(database)!.push({ workspaceId: this.defaultWorkspaceId, commandId: row.command_id, reference, kind });
        const decoded = await this.receiptContent!.read(this.defaultWorkspaceId, row.command_id, reference, kind);
        if (semanticStateChecksum({ value }) !== semanticStateChecksum({ value: decoded })) throw new Error('RECEIPT_MIGRATION_CHECKSUM_MISMATCH');
        const update = kind === 'result'
          ? 'UPDATE command_receipts SET result=NULL,result_content_ref=$3::jsonb WHERE workspace_id=$1 AND command_id=$2'
          : `UPDATE command_receipts SET error='{"sealed":true}'::jsonb,error_content_ref=$3::jsonb WHERE workspace_id=$1 AND command_id=$2`;
        await database.query(update, [this.defaultWorkspaceId, row.command_id, JSON.stringify(reference)]);
        return true;
      });
      if (!changed) break;
      migrated += 1;
    }
    return migrated;
  }

  /** Offline owner-level maintenance. Trigger changes and replacement are one locked transaction. */
  async sealLegacyRunInputs(limit = 100): Promise<number> {
    if (!this.runContent) throw new Error('RUN_CONTENT_STORE_UNAVAILABLE');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('INVALID_RUN_MIGRATION_LIMIT');
    return this.inTransaction(async database => {
      await database.query("SET LOCAL lock_timeout = '5s'");
      await database.query("SELECT pg_advisory_xact_lock(hashtext('rhiza:workspace-write:' || $1))", [this.defaultWorkspaceId]);
      await database.query('LOCK TABLE execution_runs IN ACCESS EXCLUSIVE MODE');
      const { rows } = await database.query<{ record: ExecutionRun }>('SELECT record FROM execution_runs WHERE workspace_id=$1 AND input_content_ref IS NULL ORDER BY run_id LIMIT $2', [this.defaultWorkspaceId, limit]);
      if (!rows.length) return 0;
      const replacements: Array<{ run: ExecutionRun; reference: SealedRunInputRef }> = [];
      for (const row of rows) {
        const run = asJson<ExecutionRun>(row.record);
        const reference = await this.runContent!.seal(run.workspaceId, run.id, run.input, run.inputHash);
        this.transactionContent.get(database)!.push({ workspaceId: run.workspaceId, runId: run.id, reference });
        const decoded = await this.runContent!.read(run.workspaceId, run.id, reference, run.inputHash);
        if (semanticStateChecksum(decoded as unknown as Record<string, unknown>) !== run.inputHash) throw new Error('RUN_MIGRATION_CHECKSUM_MISMATCH');
        replacements.push({ run, reference });
      }
      await database.query('ALTER TABLE execution_runs DISABLE TRIGGER execution_run_history');
      await database.query('ALTER TABLE execution_runs DISABLE TRIGGER execution_run_content_ref_immutable');
      for (const { run, reference } of replacements) {
        await database.query(`UPDATE execution_runs SET input_envelope='{"sealed":true}'::jsonb,
          record=jsonb_set(record,'{input}','{"sealed":true}'::jsonb),input_content_ref=$3::jsonb
          WHERE workspace_id=$1 AND run_id=$2`, [this.defaultWorkspaceId, run.id, JSON.stringify(reference)]);
      }
      await database.query('ALTER TABLE execution_runs ENABLE TRIGGER execution_run_history');
      await database.query('ALTER TABLE execution_runs ENABLE TRIGGER execution_run_content_ref_immutable');
      return replacements.length;
    });
  }

  /** Offline owner-level migration; ordinary Journal commands remain append-only. */
  async sealLegacyJournalPayloads(limit = 100): Promise<number> {
    if (!this.journalContent) throw new Error('JOURNAL_CONTENT_STORE_UNAVAILABLE');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('INVALID_JOURNAL_MIGRATION_LIMIT');
    return this.inTransaction(async database => {
      await database.query("SET LOCAL lock_timeout = '5s'");
      await database.query("SELECT pg_advisory_xact_lock(hashtext('rhiza:workspace-write:' || $1))", [this.defaultWorkspaceId]);
      await database.query('LOCK TABLE workspace_events IN ACCESS EXCLUSIVE MODE');
      const { rows } = await database.query<Record<string, unknown>>('SELECT * FROM workspace_events WHERE workspace_id=$1 AND payload_content_ref IS NULL ORDER BY sequence LIMIT $2', [this.defaultWorkspaceId, limit]);
      if (!rows.length) return 0;
      const replacements: Array<{ eventId: string; reference: SealedJournalRef }> = [];
      for (const row of rows) {
        const event = storedJournalEvent(row);
        const reference = await this.journalContent!.seal(event.workspaceId, event.eventId, event.payload);
        this.transactionContent.get(database)!.push({ workspaceId: event.workspaceId, eventId: event.eventId, reference });
        const decoded = await this.journalContent!.read(event.workspaceId, event.eventId, reference);
        if (semanticStateChecksum(decoded) !== semanticStateChecksum(event.payload)) throw new Error('JOURNAL_MIGRATION_CHECKSUM_MISMATCH');
        replacements.push({ eventId: event.eventId, reference });
      }
      await database.query('ALTER TABLE workspace_events DISABLE TRIGGER workspace_events_append_only');
      for (const { eventId, reference } of replacements) {
        await database.query(`UPDATE workspace_events SET payload='{"sealed":true}'::jsonb,payload_content_ref=$3::jsonb
          WHERE workspace_id=$1 AND event_id=$2`, [this.defaultWorkspaceId, eventId, JSON.stringify(reference)]);
      }
      await database.query('ALTER TABLE workspace_events ENABLE TRIGGER workspace_events_append_only');
      return replacements.length;
    });
  }

  async sealLegacyMessageContent(limit = 100): Promise<number> {
    if (!this.messageContent) throw new Error('MESSAGE_CONTENT_STORE_UNAVAILABLE');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('INVALID_MESSAGE_MIGRATION_LIMIT');
    return this.inTransaction(async database => {
      await database.query("SET LOCAL lock_timeout = '5s'");
      await database.query("SELECT pg_advisory_xact_lock(hashtext('rhiza:workspace-write:' || $1))", [this.defaultWorkspaceId]);
      const { rows } = await database.query<Record<string, unknown>>(`SELECT m.* FROM rhiza_messages m JOIN rhiza_nodes n ON n.id=m.node_id
        WHERE n.project_id=$1 AND m.content_ref IS NULL ORDER BY m.event_ordinal,m.id LIMIT $2 FOR UPDATE OF m`, [this.defaultWorkspaceId, limit]);
      for (const row of rows) {
        const message = storedMessage(row, []);
        const reference = await this.messageContent!.seal(this.defaultWorkspaceId, message.id, message);
        this.transactionContent.get(database)!.push({ workspaceId: this.defaultWorkspaceId, messageId: message.id, reference });
        const decoded = await this.messageContent!.read(this.defaultWorkspaceId, message.id, reference);
        const original = { text: message.text, reasoning: message.reasoning, toolCalls: message.toolCalls };
        if (semanticStateChecksum(decoded) !== semanticStateChecksum(original)) throw new Error('MESSAGE_MIGRATION_CHECKSUM_MISMATCH');
        await database.query("UPDATE rhiza_messages SET body='',reasoning=NULL,tool_calls=NULL,content_ref=$2::jsonb WHERE id=$1", [message.id, JSON.stringify(reference)]);
      }
      return rows.length;
    });
  }

  async read(): Promise<WorkspaceData> {
    return this.inTransaction(async database => {
      const existing = await this.readFrom(database);
      if (existing) return existing;
      await database.query("SELECT pg_advisory_xact_lock(hashtext('rhiza:workspace:init'))");
      const afterLock = await this.readFrom(database);
      if (afterLock) return afterLock;
      const seed = relationalSeed(this.defaultWorkspaceId);
      await this.persist(database, seed);
      return seed;
    });
  }

  async readExisting(): Promise<WorkspaceData | undefined> {
    return this.inTransaction(database => this.readFrom(database, true));
  }

  async update(mutator: (current: WorkspaceData) => WorkspaceData | Promise<WorkspaceData>, options?: WorkspaceUpdateOptions): Promise<WorkspaceData> {
    let result!: WorkspaceData;
    this.queue = this.queue.catch(() => undefined).then(async () => {
      result = await this.inTransaction(async database => {
        let current = await this.readFrom(database, true);
        if (!current) {
          current = relationalSeed(this.defaultWorkspaceId);
          await this.persist(database, current);
          await database.query('SELECT id FROM rhiza_projects WHERE id = $1 FOR UPDATE', [this.defaultWorkspaceId]);
        }
        const next = await mutator(structuredClone(current));
        validateWorkspaceHistoryUpdate(current, next, options);
        next.updatedAt = new Date().toISOString();
        const audit: AuditEvent = {
          id: randomUUID(), projectId: next.projectId, nodeId: next.activeNodeId,
          action: 'workspace.updated', entityType: 'workspace', entityId: next.projectId,
          metadata: { backend: 'postgres', nodes: next.discussionNodes.length, events: next.messages.length }, createdAt: next.updatedAt,
        };
        next.auditEvents = [...next.auditEvents, audit];
        await this.persist(database, next, current, options);
        return next;
      });
    });
    await this.queue;
    return result;
  }

  async executeWorkspaceLifecycle(context: import('./domain-journal').CommandFactContext, command: WorkspaceLifecycleCommand): Promise<WorkspaceRecord> {
    const target = command.workspaceId === this.defaultWorkspaceId ? this : this.forWorkspace(command.workspaceId) as PostgresWorkspaceStore;
    if (target !== this) return target.executeWorkspaceLifecycle(context, command);
    let result!: WorkspaceRecord;
    let failure: unknown;
    this.queue = this.queue.catch(() => undefined).then(async () => {
      try { result = await this.executeWorkspaceLifecycleNow(context, command); }
      catch (error) { failure = error; }
    });
    await this.queue;
    if (failure) throw failure;
    return result;
  }

  private async executeWorkspaceLifecycleNow(context: import('./domain-journal').CommandFactContext, command: WorkspaceLifecycleCommand): Promise<WorkspaceRecord> {
    return this.inCommandTransaction(context, async database => {
      const receipt = await database.query<Record<string, unknown>>('SELECT * FROM command_receipts WHERE workspace_id=$1 AND command_id=$2', [command.workspaceId, context.commandId]);
      if (receipt.rows[0]) {
        if (receipt.rows[0].status === 'rejected') {
          const rejection = await this.readReceiptResult<{ message: string; code: string; status: number }>(receipt.rows[0], 'error');
          throw Object.assign(new Error(rejection.message), rejection, { storedReceipt: true });
        }
        return this.readReceiptResult<WorkspaceRecord>(receipt.rows[0]);
      }

      let record: WorkspaceRecord;
      let eventType: DomainEventEnvelope['eventType'];
      if (command.kind === 'create') {
        await database.query("INSERT INTO users (user_id,display_name) VALUES ($1,'Local user') ON CONFLICT (user_id) DO NOTHING", [command.createdBy]);
        const collision = await database.query<{ workspace_id: string }>('SELECT workspace_id FROM workspaces WHERE workspace_id=$1', [command.workspaceId]);
        if (collision.rows[0]) throw Object.assign(new Error('Workspace 已存在。'), { code: 'WORKSPACE_ALREADY_EXISTS', status: 409 });
        const seed = { ...relationalSeed(command.workspaceId), projectTitle: command.name };
        await this.persist(database, seed);
        await database.query("INSERT INTO workspaces (workspace_id,name,status,created_by,settings) VALUES ($1,$2,'active',$3,$4::jsonb)", [command.workspaceId, command.name, command.createdBy, JSON.stringify({ revision: 1 })]);
        await database.query("INSERT INTO workspace_members (workspace_id,user_id,role) VALUES ($1,$2,'owner')", [command.workspaceId, command.createdBy]);
        record = { workspaceId: command.workspaceId, name: command.name, status: 'active', createdBy: command.createdBy, revision: 1 };
        eventType = 'workspace.created';
      } else {
        const current = await database.query<{ workspace_id: string; name: string; status: 'active' | 'archived'; created_by: string; revision: number }>("SELECT workspace_id,name,status,created_by,COALESCE((settings->>'revision')::integer,1) revision FROM workspaces WHERE workspace_id=$1 FOR UPDATE", [command.workspaceId]);
        const existing = current.rows[0];
        if (!existing) throw Object.assign(new Error('Workspace 不存在。'), { code: 'WORKSPACE_NOT_FOUND', status: 404 });
        if (existing.revision !== command.expectedRevision) throw Object.assign(new Error('工作区版本已变化，请刷新后重试。'), { code: 'WORKSPACE_REVISION_CONFLICT', status: 409 });
        const name = command.kind === 'rename' ? command.name : existing.name;
        const status = command.kind === 'archive' ? 'archived' as const : command.kind === 'restore' ? 'active' as const : existing.status;
        const revision = existing.revision + 1;
        await database.query("UPDATE workspaces SET name=$2,status=$3,settings=jsonb_set(settings,'{revision}',to_jsonb($4::int),true),updated_at=now() WHERE workspace_id=$1", [command.workspaceId, name, status, revision]);
        if (command.kind === 'rename') await database.query('UPDATE rhiza_projects SET title=$2,updated_at=now() WHERE id=$1', [command.workspaceId, name]);
        record = { workspaceId: command.workspaceId, name, status, createdBy: existing.created_by, revision };
        eventType = command.kind === 'rename' ? 'workspace.renamed' : command.kind === 'archive' ? 'workspace.archived' : 'workspace.restored';
      }

      const head = await database.query<{ last_sequence: number }>(`
        INSERT INTO workspace_event_heads (workspace_id,last_sequence) VALUES ($1,1)
        ON CONFLICT (workspace_id) DO UPDATE SET last_sequence=workspace_event_heads.last_sequence+1,updated_at=now()
        RETURNING last_sequence
      `, [command.workspaceId]);
      const sequence = Number(head.rows[0]!.last_sequence);
      const currentState = await this.readFrom(database);
      if (!currentState) throw new Error('Workspace lifecycle committed without state');
      const lifecyclePayload = {
        name: record.name, status: record.status, revision: record.revision,
        reconcileChecksum: semanticChecksum(currentState), stateSchema: 'rhiza.workspace-semantic.v1',
        ...(command.kind === 'create'
          ? { snapshot: { stateSchema: 'rhiza.workspace-semantic.v1', sourceSequence: sequence, state: workspaceSemanticSnapshot(currentState) } }
          : { stateChanges: command.kind === 'rename' ? { projectTitle: record.name } : {} }),
      };
      const eventId = randomUUID();
      const sealed = await this.prepareJournalPayload(database, command.workspaceId, eventId, lifecyclePayload);
      await database.query(`
        INSERT INTO workspace_events
          (event_id,workspace_id,sequence,ce_specversion,rhiza_envelope_version,event_type,event_source,subject,data_schema,aggregate_type,aggregate_id,aggregate_revision,actor_ref,scope_ref,command_id,event_index,causation_id,correlation_id,payload,occurred_at,payload_content_ref)
        VALUES ($1,$2::uuid,$3,'1.0',$4,$5,$6,$7,$8,'workspace',$2::text,$9,$10::jsonb,$11::jsonb,$12,0,$13,$14,$15::jsonb,$16,$17::jsonb)
      `, [eventId, command.workspaceId, sequence, DOMAIN_EVENT_SCHEMA_VERSION, eventType,
        journalSource(command.workspaceId), journalSubject('workspace', command.workspaceId), journalDataSchema(eventType), record.revision,
        JSON.stringify(context.actor), JSON.stringify({ scopeType: 'workspace', scopeId: command.workspaceId }), context.commandId,
        context.causationId || null, context.correlationId || null, sealed.payload, context.occurredAt, sealed.reference]);
      await this.insertCommittedReceipt(database, command.workspaceId, context.commandId, context.commandType, sequence, sequence, record);
      return record;
    });
  }

  async executeCommand<T>(command: TransactionalWorkspaceCommand<T>): Promise<TransactionalWorkspaceCommandResult<T>> {
    let result!: TransactionalWorkspaceCommandResult<T>;
    let failure: unknown;
    this.queue = this.queue.catch(() => undefined).then(async () => {
      try { result = await this.executeCommandNow(command); }
      catch (error) { failure = error; }
    });
    await this.queue;
    if (failure) throw failure;
    return result;
  }

  private async executeCommandNow<T>(command: TransactionalWorkspaceCommand<T>): Promise<TransactionalWorkspaceCommandResult<T>> {
    return this.inCommandTransaction(command.context, async database => {
      const existing = await database.query<Record<string, unknown>>('SELECT * FROM command_receipts WHERE workspace_id=$1 AND command_id=$2', [this.defaultWorkspaceId, command.context.commandId]);
      if (existing.rows[0]) {
        const receipt = existing.rows[0];
        if (receipt.status === 'rejected') {
          const rejection = await this.readReceiptResult<{ message: string; code: string; status: number }>(receipt, 'error');
          throw Object.assign(new Error(rejection.message), rejection, { storedReceipt: true });
        }
        const workspace = await this.readFrom(database, true);
        if (!workspace) throw new Error(`Committed receipt exists without Workspace state for ${this.defaultWorkspaceId}`);
        return { workspace, value: await this.readReceiptResult<T>(receipt), duplicate: true };
      }

      let current = await this.readFrom(database, true);
      if (!current) {
        current = relationalSeed(this.defaultWorkspaceId);
        await this.persist(database, current);
        await database.query('SELECT id FROM rhiza_projects WHERE id=$1 FOR UPDATE', [this.defaultWorkspaceId]);
      }
      const directoryRevision = await database.query<{ revision: number; status: string }>("SELECT COALESCE((settings->>'revision')::integer,1) revision,status FROM workspaces WHERE workspace_id=$1 FOR UPDATE", [this.defaultWorkspaceId]);
      if (directoryRevision.rows[0]?.status === 'archived' && !(command.options?.run?.kind === 'transition' && ['failed', 'canceled', 'interrupted'].includes(command.options.run.patch.status))) throw Object.assign(new Error('归档工作区为只读，请先恢复。'), { code: 'WORKSPACE_ARCHIVED', status: 409 });
      let aggregateRevision = Number(directoryRevision.rows[0]?.revision || 0);
      if (command.context.expectedRevision !== undefined) {
        if (!directoryRevision.rows[0] || aggregateRevision !== command.context.expectedRevision) {
          throw Object.assign(new Error('工作区版本已变化，请刷新后重试。'), { code: 'WORKSPACE_REVISION_CONFLICT', status: 409 });
        }
      }
      if (directoryRevision.rows[0]) {
        aggregateRevision += 1;
        await database.query("UPDATE workspaces SET settings=jsonb_set(settings,'{revision}',to_jsonb($2::int),true),updated_at=now() WHERE workspace_id=$1", [this.defaultWorkspaceId, aggregateRevision]);
      }
      if (command.options?.run) await this.applyRunMutation(database, command.options.run);
      const result = await command.apply(structuredClone(current));
      validateWorkspaceHistoryUpdate(current, result.next, command.options);
      const next = { ...result.next, updatedAt: new Date().toISOString() };
      const audit: AuditEvent = {
        id: randomUUID(), projectId: next.projectId, nodeId: next.activeNodeId,
        action: 'workspace.updated', entityType: 'workspace', entityId: next.projectId,
        metadata: { backend: 'transaction-facts', commandType: command.context.commandType }, createdAt: next.updatedAt,
      };
      next.auditEvents = [...next.auditEvents, audit];
      const events = command.events(current, next, result.value);
      if (!events.length) throw new Error(`Persistent command ${command.context.commandType} produced no Domain Event`);
      await this.persist(database, next, current, command.options);
      const recovered = await this.readFrom(database);
      if (!recovered || semanticChecksum(recovered) !== semanticChecksum(next)) throw new Error('Shadow reconcile mismatch after transactional Workspace write');

      const head = await database.query<{ last_sequence: number }>(`
        INSERT INTO workspace_event_heads (workspace_id,last_sequence) VALUES ($1,$2)
        ON CONFLICT (workspace_id) DO UPDATE
        SET last_sequence=workspace_event_heads.last_sequence + $2,updated_at=now()
        RETURNING last_sequence
      `, [this.defaultWorkspaceId, events.length]);
      const lastSequence = Number(head.rows[0]!.last_sequence);
      const firstSequence = lastSequence - events.length + 1;
      for (const [offset, event] of events.entries()) {
        const eventId = randomUUID();
        const sealed = await this.prepareJournalPayload(database, this.defaultWorkspaceId, eventId, { ...event.payload, reconcileChecksum: semanticChecksum(next), stateSchema: 'rhiza.workspace-semantic.v1', ...(offset === events.length - 1 ? { stateChanges: workspaceSemanticChanges(current, next) } : {}) });
        await database.query(`
          INSERT INTO workspace_events
            (event_id,workspace_id,sequence,ce_specversion,rhiza_envelope_version,event_type,event_source,subject,data_schema,aggregate_type,aggregate_id,aggregate_revision,actor_ref,scope_ref,command_id,event_index,causation_id,correlation_id,payload,occurred_at,payload_content_ref)
          VALUES ($1,$2,$3,'1.0',$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18::jsonb,$19,$20::jsonb)
        `, [eventId, this.defaultWorkspaceId, firstSequence + offset, DOMAIN_EVENT_SCHEMA_VERSION, event.eventType,
          journalSource(this.defaultWorkspaceId), journalSubject(event.aggregateType, event.aggregateId), journalDataSchema(event.eventType),
          event.aggregateType, event.aggregateId, aggregateRevision, JSON.stringify(command.context.actor), JSON.stringify(command.context.scope),
          command.context.commandId, offset, command.context.causationId || null, command.context.correlationId || null,
          sealed.payload, command.context.occurredAt, sealed.reference]);
      }
      await this.insertCommittedReceipt(database, this.defaultWorkspaceId, command.context.commandId, command.context.commandType, firstSequence, lastSequence, result.value);
      return { workspace: recovered, value: result.value, duplicate: false };
    });
  }

  private async inCommandTransaction<T>(context: CommandFactContext, operation: (database: SqlQueryable) => Promise<T>): Promise<T> {
    let rejection: unknown;
    const result = await this.inTransaction(async database => {
      await database.query("SELECT pg_advisory_xact_lock(hashtext('rhiza:command:' || $1 || ':' || $2))", [this.defaultWorkspaceId, context.commandId]);
      // All command kinds acquire workspace locks in the same order, including lifecycle writes.
      await database.query("SELECT pg_advisory_xact_lock(hashtext('rhiza:workspace-write:' || $1))", [this.defaultWorkspaceId]);
      const prior = await database.query<{ command_type: string }>('SELECT command_type FROM command_receipts WHERE workspace_id=$1 AND command_id=$2', [this.defaultWorkspaceId, context.commandId]);
      if (prior.rows[0] && prior.rows[0].command_type !== context.commandType) throw Object.assign(new Error('Command id 已被其他命令使用。'), { code: 'COMMAND_ID_CONFLICT', status: 409 });
      await database.query('SAVEPOINT command_mutation');
      try {
        return await operation(database);
      } catch (error) {
        const candidate = error as { message?: string; code?: string; status?: number; storedReceipt?: boolean; details?: { code?: string; status?: number } };
        const status = Number(candidate.details?.status ?? candidate.status ?? 500);
        if (candidate.storedReceipt || status < 400 || status >= 500) throw error;
        await database.query('ROLLBACK TO SAVEPOINT command_mutation');
        await this.discardPendingContent(this.transactionContent.get(database)!);
        const code = String(candidate.details?.code ?? candidate.code ?? 'COMMAND_REJECTED');
        const value = { message: candidate.message || 'Command rejected', code, status };
        const reference = await this.receiptContent?.seal(this.defaultWorkspaceId, context.commandId, value, 'error');
        if (reference) this.transactionContent.get(database)!.push({ workspaceId: this.defaultWorkspaceId, commandId: context.commandId, reference, kind: 'error' });
        const inserted = await database.query(`
          INSERT INTO command_receipts (workspace_id,command_id,command_type,status,error,error_content_ref)
          SELECT id,$2,$3,'rejected',$4::jsonb,$5::jsonb FROM rhiza_projects WHERE id=$1
          ON CONFLICT (workspace_id,command_id) DO NOTHING
          RETURNING command_id
        `, [this.defaultWorkspaceId, context.commandId, context.commandType, JSON.stringify(reference ? { sealed: true } : value), reference ? JSON.stringify(reference) : null]);
        if (!inserted.rows.length) await this.discardPendingContent(this.transactionContent.get(database)!);
        rejection = error;
        return undefined;
      }
    });
    if (rejection) throw rejection;
    return result!;
  }

  /** Call once at exclusive server startup, before accepting requests. Never retry external calls. */
  async reconcileRuns(): Promise<number> {
    const stale = await this.database.query<{ workspace_id: string; run_id: string; attempt: number; record: ExecutionRun; trace_count: number }>("SELECT workspace_id,run_id,attempt,record,(SELECT count(*)::int FROM execution_run_traces t WHERE t.run_id=r.run_id AND t.attempt=r.attempt) trace_count FROM execution_runs r WHERE status IN ('created','dispatching','running')");
    let count = 0;
    for (const row of stale.rows) {
      const target = this.forWorkspace(row.workspace_id) as PostgresWorkspaceStore;
      const at = new Date().toISOString();
      await target.executeCommand({
        context: { commandId: `run:recover:${row.run_id}`, commandType: 'ReconcileExecutionRun', actor: { actorType: 'system', actorId: 'rhiza-startup' }, scope: { scopeType: 'workspace', scopeId: row.workspace_id }, occurredAt: at },
        options: { run: { kind: 'transition', runId: row.run_id, attempt: row.attempt, from: ['created','dispatching','running'], patch: { status: 'interrupted', terminalAt: at, telemetry: { ...asJson<ExecutionRun>(row.record).telemetry, traceCount: Number(row.trace_count), durationMs: Math.max(0, Date.parse(at) - Date.parse(asJson<ExecutionRun>(row.record).createdAt)) }, error: { code: 'PROCESS_INTERRUPTED', class: 'interrupted', message: '服务重启，无法确认外部执行完成；请手动重试。' } } } },
        apply: async current => ({ next: current, value: { runId: row.run_id } }),
        events: () => [{ eventType: 'run.status.changed', aggregateType: 'run', aggregateId: row.run_id, payload: { status: 'interrupted' } }],
      });
      count += 1;
    }
    return count;
  }

  private async decodeRun(row: { record: ExecutionRun; input_content_ref: unknown }): Promise<ExecutionRun> {
    const record = asJson<ExecutionRun>(row.record);
    if (row.input_content_ref == null) return record;
    if (!this.runContent) throw new Error('RUN_CONTENT_STORE_UNAVAILABLE');
    const input = await this.runContent.read(record.workspaceId, record.id, asJson<SealedRunInputRef>(row.input_content_ref), record.inputHash);
    return { ...record, input };
  }

  async listRuns(limit = 50): Promise<ExecutionRun[]> {
    const result = await this.database.query<{ record: ExecutionRun; input_content_ref: unknown }>(`SELECT record,input_content_ref FROM execution_runs WHERE workspace_id=$1 ORDER BY record->>'createdAt' DESC, run_id LIMIT $2`, [this.defaultWorkspaceId, Math.min(10000, Math.max(1, limit))]);
    return Promise.all(result.rows.map(row => this.decodeRun(row)));
  }

  async readProvenance(outputId: string): Promise<ProvenanceLink | undefined> {
    const result = await this.database.query<{ record: ProvenanceLink }>('SELECT record FROM provenance_links WHERE workspace_id=$1 AND output_ref=$2', [this.defaultWorkspaceId, outputId]);
    return result.rows[0] ? asJson<ProvenanceLink>(result.rows[0].record) : undefined;
  }

  async readPortableWorkspace(): Promise<import('./application/ports/portable-workspace').PortableWorkspaceFacts> {
    return this.inTransaction(async database => {
      await database.query("SELECT pg_advisory_xact_lock(hashtext('rhiza:workspace-write:' || $1))", [this.defaultWorkspaceId]);
      const workspace = await this.readFrom(database, true);
      if (!workspace) throw Object.assign(new Error('Workspace not found'), { code: 'WORKSPACE_NOT_FOUND', status: 404 });
      const directory = await database.query<{ workspace_id: string; name: string; status: 'active' | 'archived'; created_by: string; revision: number }>("SELECT workspace_id,name,status,created_by,COALESCE((settings->>'revision')::integer,1) revision FROM workspaces WHERE workspace_id=$1", [this.defaultWorkspaceId]);
      const record = directory.rows[0];
      if (!record) throw Object.assign(new Error('Workspace directory missing'), { code: 'WORKSPACE_NOT_FOUND', status: 404 });
      const members = await database.query<{ user_id: string; role: 'owner' | 'member' }>('SELECT user_id,role FROM workspace_members WHERE workspace_id=$1 ORDER BY user_id', [this.defaultWorkspaceId]);
      const runs = await database.query<{ record: ExecutionRun; input_content_ref: unknown }>('SELECT record,input_content_ref FROM execution_runs WHERE workspace_id=$1 ORDER BY run_id', [this.defaultWorkspaceId]);
      const provenance = await database.query<{ record: ProvenanceLink }>('SELECT record FROM provenance_links WHERE workspace_id=$1 ORDER BY output_ref', [this.defaultWorkspaceId]);
      const journal = await database.query<Record<string, unknown>>('SELECT * FROM workspace_events WHERE workspace_id=$1 ORDER BY sequence', [this.defaultWorkspaceId]);
      return { workspace, directory: { workspaceId: record.workspace_id, name: record.name, status: record.status, createdBy: record.created_by, revision: Number(record.revision) },
        members: members.rows.map(member => ({ userId: member.user_id, role: member.role })),
        runs: await Promise.all(runs.rows.map(row => this.decodeRun(row))), provenance: provenance.rows.map(row => asJson<ProvenanceLink>(row.record)), journal: await Promise.all(journal.rows.map(row => this.decodeJournalEvent(row))) };
    });
  }

  async activatePortableImport(importId: string, ownerId: string, facts: PortableWorkspaceFacts): Promise<void> {
    const conflict = (code: string) => Object.assign(new Error(code), { code, status: 409 });
    if (facts.workspace.projectId !== this.defaultWorkspaceId) throw conflict('BUNDLE_WORKSPACE_MISMATCH');
    validatePortableReferences(facts);
    validatePortableHistory(facts, semanticStateChecksum);
    await this.inTransaction(async database => {
      const checkpoints = await database.query<BundleImportCheckpoint>('SELECT workspace_id AS "workspaceId",state_digest AS "stateDigest",phase FROM bundle_imports WHERE import_id=$1 AND owner_id=$2 FOR UPDATE', [importId, ownerId]);
      const checkpoint = checkpoints.rows[0];
      if (!checkpoint || checkpoint.workspaceId !== facts.workspace.projectId || checkpoint.stateDigest !== semanticStateChecksum({ facts })) throw conflict('BUNDLE_IMPORT_CONFLICT');
      if (checkpoint.phase === 'activated') return;
      if (checkpoint.phase !== 'blobs-ready') throw conflict('BUNDLE_IMPORT_NOT_READY');
      // Import alone takes coarse locks: existing legacy upserts must not touch another Workspace's IDs.
      const collections: Array<[string, string, Array<{ id: string }>]> = [
        ['rhiza_nodes', 'id', facts.workspace.discussionNodes], ['rhiza_messages', 'id', facts.workspace.messages],
        ['rhiza_segments', 'id', facts.workspace.segments], ['rhiza_context_manifests', 'id', facts.workspace.manifests],
        ['rhiza_attachments', 'id', facts.workspace.attachments], ['rhiza_anchors', 'id', facts.workspace.anchors],
        ['rhiza_edges', 'id', facts.workspace.discussionEdges], ['rhiza_audit_events', 'id', facts.workspace.auditEvents],
        ['rhiza_resources', 'resource_id', facts.workspace.resources], ['rhiza_resource_versions', 'resource_version_id', facts.workspace.resourceVersions],
        ['rhiza_resource_materializations', 'materialization_id', facts.workspace.materializations], ['execution_runs', 'run_id', facts.runs],
      ];
      await database.query(`LOCK TABLE rhiza_projects,workspaces,${collections.map(([table]) => table).join(',')} IN SHARE ROW EXCLUSIVE MODE`);
      if ((await database.query('SELECT id FROM rhiza_projects WHERE id=$1', [this.defaultWorkspaceId])).rows.length) throw conflict('BUNDLE_TARGET_EXISTS');
      for (const [table, key, values] of collections) {
        if (values.length && (await database.query(`SELECT 1 FROM ${table} WHERE ${key}::text=ANY($1::text[]) LIMIT 1`, [values.map(value => value.id)])).rows.length) throw conflict('BUNDLE_IDENTITY_COLLISION');
      }
      await database.query('INSERT INTO rhiza_projects(id,title,state) VALUES ($1,$2,$3::jsonb)', [this.defaultWorkspaceId, facts.workspace.projectTitle, '{}']);
      for (const member of facts.members) await database.query("INSERT INTO users(user_id,display_name) VALUES ($1,'Imported user') ON CONFLICT DO NOTHING", [member.userId]);
      const record = facts.directory;
      await database.query('INSERT INTO workspaces(workspace_id,name,status,created_by,settings) VALUES ($1,$2,$3,$4,$5::jsonb)', [record.workspaceId, record.name, record.status, record.createdBy, JSON.stringify({ revision: record.revision })]);
      for (const member of facts.members) await database.query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,$3)', [record.workspaceId, member.userId, member.role]);
      const children = new Map<string, ExecutionRun[]>();
      const ordered = facts.runs.filter(run => !run.parentRunRef);
      for (const run of facts.runs) if (run.parentRunRef) {
        const siblings = children.get(run.parentRunRef) ?? [];
        siblings.push(run); children.set(run.parentRunRef, siblings);
      }
      for (let index = 0; index < ordered.length; index++) ordered.push(...(children.get(ordered[index].id) ?? []));
      if (ordered.length !== facts.runs.length) throw conflict('BUNDLE_RUN_LINEAGE_CYCLE');
      for (const run of ordered) await this.insertRun(database, run);
      for (const link of facts.provenance) await database.query('INSERT INTO provenance_links(workspace_id,output_ref,provenance_id,record) VALUES ($1,$2,$3,$4::jsonb)', [link.workspaceId, link.outputRef, link.id, JSON.stringify(link)]);
      await this.persist(database, facts.workspace);
      for (const event of facts.journal) {
        const sealed = await this.prepareJournalPayload(database, event.workspaceId, event.eventId, event.payload);
        await database.query(`INSERT INTO workspace_events
        (event_id,workspace_id,sequence,ce_specversion,rhiza_envelope_version,event_type,event_source,subject,data_schema,aggregate_type,aggregate_id,aggregate_revision,actor_ref,scope_ref,command_id,event_index,causation_id,correlation_id,payload,occurred_at,recorded_at,payload_content_ref)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16,$17,$18,$19::jsonb,$20,$21,$22::jsonb)`,
      [event.eventId,event.workspaceId,event.sequence,event.ceSpecversion,event.envelopeVersion,event.eventType,event.eventSource,event.subject,event.dataSchema,event.aggregateType,event.aggregateId,event.aggregateRevision,JSON.stringify(event.actor),JSON.stringify(event.scope),event.commandId,event.eventIndex,event.causationId ?? null,event.correlationId ?? null,sealed.payload,event.occurredAt,event.recordedAt,sealed.reference]);
      }
      await database.query('INSERT INTO workspace_event_heads(workspace_id,last_sequence) VALUES ($1,$2)', [record.workspaceId, facts.journal.length]);
      await database.query("UPDATE bundle_imports SET phase='activated',revision=revision+1,updated_at=now() WHERE import_id=$1", [importId]);
    });
  }

  async backfillProvenance(): Promise<number> {
    return this.inTransaction(async database => {
      await database.query("SELECT pg_advisory_xact_lock(hashtext('rhiza:workspace-write:' || $1))", [this.defaultWorkspaceId]);
      const workspace = await this.readFrom(database, true);
      if (!workspace) return 0;
      return this.persistProvenance(database, workspace, workspace.messages);
    });
  }

  async getRun(runId: string): Promise<ExecutionRun | undefined> {
    const result = await this.database.query<{ record: ExecutionRun; input_content_ref: unknown }>('SELECT record,input_content_ref FROM execution_runs WHERE workspace_id=$1 AND run_id=$2', [this.defaultWorkspaceId, runId]);
    return result.rows[0] ? this.decodeRun(result.rows[0]) : undefined;
  }

  async writeRunTraces(runId: string, attempt: number, traces: RunTrace[]) {
    await this.database.query(`INSERT INTO execution_run_traces (run_id,attempt,sequence,record)
      SELECT r.run_id,$3,(t->>'sequence')::int,t FROM execution_runs r, jsonb_array_elements($4::jsonb) t
      WHERE r.workspace_id=$1 AND r.run_id=$2 AND r.attempt=$3
      ON CONFLICT (run_id,attempt,sequence) DO NOTHING`, [this.defaultWorkspaceId, runId, attempt, JSON.stringify(traces)]);
  }

  private async insertRun(database: SqlQueryable, run: ExecutionRun) {
    if (run.workspaceId !== this.defaultWorkspaceId || semanticStateChecksum(run.input as unknown as Record<string, unknown>) !== run.inputHash) throw new Error('Invalid ExecutionRun input');
    let reference: SealedRunInputRef | undefined;
    if (this.runContent) {
      const pending = this.transactionContent.get(database);
      if (!pending) throw new Error('RUN_CONTENT_REQUIRES_TRANSACTION');
      reference = await this.runContent.seal(run.workspaceId, run.id, run.input, run.inputHash);
      pending.push({ workspaceId: run.workspaceId, runId: run.id, reference });
    }
    const input = reference ? { sealed: true } : run.input;
    await database.query(`INSERT INTO execution_runs
      (run_id,workspace_id,command_id,node_id,status,attempt,parent_run_ref,input_envelope,input_hash,model_spec_ref,provider_endpoint_ref,record,input_content_ref)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12::jsonb,$13::jsonb)`,
    [run.id,run.workspaceId,run.commandId,run.nodeId,run.status,run.attempt,run.parentRunRef ?? null,JSON.stringify(input),run.inputHash,run.input.executor.modelSpecRef,run.input.executor.providerEndpointRef,JSON.stringify({ ...run, input }),reference ? JSON.stringify(reference) : null]);
  }

  private async applyRunMutation(database: SqlQueryable, mutation: RunMutation) {
    if (mutation.kind === 'create') {
      const run = mutation.run;
      if (run.status !== 'created') throw new Error('Invalid ExecutionRun input');
      await this.insertRun(database, run);
      return;
    }
    const result = await database.query(`UPDATE execution_runs SET status=$4,record=record || $5::jsonb
      WHERE workspace_id=$1 AND run_id=$2 AND attempt=$3 AND status=ANY($6::text[]) RETURNING run_id`,
      [this.defaultWorkspaceId,mutation.runId,mutation.attempt,mutation.patch.status,JSON.stringify(mutation.patch),mutation.from]);
    if (!result.rows.length) throw Object.assign(new Error('执行已终止或状态已变化，迟到结果未写入。'), { code: 'RUN_STATE_CONFLICT', status: 409 });
  }

  private async decodeJournalEvent(row: Record<string, unknown>): Promise<DomainEventEnvelope> {
    const event = storedJournalEvent(row);
    if (row.payload_content_ref == null) return event;
    if (!this.journalContent) throw new Error('JOURNAL_CONTENT_STORE_UNAVAILABLE');
    return { ...event, payload: await this.journalContent.read(event.workspaceId, event.eventId, asJson<SealedJournalRef>(row.payload_content_ref)) };
  }

  async readJournal(limit = 50): Promise<DomainEventEnvelope[]> {
    const result = await this.database.query<Record<string, unknown>>(`
      SELECT * FROM workspace_events WHERE workspace_id=$1 ORDER BY sequence DESC LIMIT $2
    `, [this.defaultWorkspaceId, Math.min(10_000, Math.max(1, limit))]);
    return Promise.all(result.rows.map(row => this.decodeJournalEvent(row)));
  }

  async readContextHistory(input: { manifestId: string } | { messageId: string }): Promise<import('./application/ports/workspace-unit-of-work').ContextHistoryFacts | undefined> {
    const manifestId = 'manifestId' in input ? input.manifestId : (await this.database.query<{ manifest_id: string }>(
      'SELECT coalesce(m.manifest_id,(SELECT reply.manifest_id FROM rhiza_messages reply WHERE reply.reply_to_message_id=m.id AND reply.node_id=m.node_id AND reply.manifest_id IS NOT NULL ORDER BY reply.event_ordinal LIMIT 1)) AS manifest_id FROM rhiza_messages m JOIN rhiza_nodes n ON n.id=m.node_id WHERE n.project_id=$1 AND m.id::text=$2', [this.defaultWorkspaceId, input.messageId])).rows[0]?.manifest_id;
    if (!manifestId) return undefined;
    const result = await this.database.query<{ manifest: unknown }>('SELECT manifest FROM rhiza_context_manifests WHERE project_id=$1 AND id::text=$2', [this.defaultWorkspaceId, manifestId]);
    if (!result.rows[0]) return undefined;
    const manifest = asJson<ContextManifest>(result.rows[0].manifest);
    const [resources, versions] = await Promise.all([
      this.database.query<Record<string, unknown>>('SELECT * FROM rhiza_resources WHERE workspace_id=$1 AND resource_id=ANY($2::text[])', [this.defaultWorkspaceId, manifest.contextItems.flatMap(item => item.resourceId ? [item.resourceId] : [])]),
      this.database.query<Record<string, unknown>>('SELECT rv.* FROM rhiza_resource_versions rv JOIN rhiza_resources r ON r.resource_id=rv.resource_id WHERE r.workspace_id=$1 AND rv.resource_version_id=ANY($2::text[])', [this.defaultWorkspaceId, manifest.contextItems.flatMap(item => item.resourceVersionId ? [item.resourceVersionId] : [])]),
    ]);
    return { manifest, resources: resources.rows.map(row => ({ id: String(row.resource_id), workspaceId: String(row.workspace_id), kind: row.kind as Resource['kind'], logicalName: String(row.logical_name), createdAt: asIso(row.created_at) })), versions: versions.rows.map(storedResourceVersion) };
  }

  async readConversationPreparation(attachmentIds: string[], sourceMessageId?: string): Promise<import('./application/ports/workspace-unit-of-work').ConversationPreparation> {
    return this.inTransaction(async database => {
      await database.query("SELECT pg_advisory_xact_lock(hashtext('rhiza:workspace-write:' || $1))", [this.defaultWorkspaceId]);
      const project = (await database.query<{ id: string; active_node_id: string | null; mode: WorkspaceData['mode'] | null; context_items: unknown }>(
        "SELECT id,active_node_id,state->>'mode' AS mode,state->'contextItems' AS context_items FROM rhiza_projects WHERE id=$1", [this.defaultWorkspaceId])).rows[0];
      if (!project) throw Object.assign(new Error('Workspace is unavailable'), { code: 'WORKSPACE_NOT_FOUND', status: 404 });
      const node = (await database.query<{ id: string; status: DiscussionNode['status'] }>(
        'SELECT id,status FROM rhiza_nodes WHERE project_id=$1 AND ($2::uuid IS NULL OR id=$2::uuid) ORDER BY created_at,id LIMIT 1', [project.id, project.active_node_id])).rows[0];
      const nodeId = node?.id ?? project.active_node_id ?? '';
      const messages = node ? (await database.query<Record<string, unknown>>(
        'SELECT m.*,cm.request_id AS source_request_id,ARRAY(SELECT ma.attachment_id FROM rhiza_message_attachments ma WHERE ma.message_id=m.id ORDER BY ma.ordinal) AS attachment_ids FROM rhiza_messages m LEFT JOIN rhiza_context_manifests cm ON cm.id=m.manifest_id AND cm.project_id=$2 WHERE m.node_id=$1 ORDER BY m.event_ordinal,m.id', [node.id, project.id])).rows : [];
      const attachments = attachmentIds.length ? (await database.query<Record<string, unknown>>(
        'SELECT a.*,rv.digest,rv.blob_ref FROM rhiza_attachments a LEFT JOIN rhiza_resource_versions rv ON rv.resource_version_id=a.resource_version_id WHERE a.project_id=$1 AND a.id::text=ANY($2::text[]) ORDER BY a.created_at,a.id', [project.id, attachmentIds])).rows : [];
      return {
        sourceRunId: (messages.find(row => row.id === sourceMessageId)?.source_request_id ?? undefined) as string | undefined,
        projectId: project.id, activeNodeId: nodeId, node, mode: project.mode || 'Assisted', contextItems: asJson(project.context_items || []),
        messages: await Promise.all(messages.map(row => this.decodeMessage(row, row.attachment_ids as string[]))),
        attachments: attachments.map(storedAttachment),
      };
    });
  }

  async queryContextCandidates(input: ContextPlanningInput) {
    if (input.workspaceId !== this.defaultWorkspaceId) throw new Error('CONTEXT_WORKSPACE_MISMATCH');
    return this.inTransaction(async database => {
      await database.query("SELECT pg_advisory_xact_lock(hashtext('rhiza:workspace-write:' || $1))", [this.defaultWorkspaceId]);
      return queryContextCandidates(database, input);
    });
  }

  async rebuildContextCandidates() {
    return this.inTransaction(async database => {
      await database.query("SELECT pg_advisory_xact_lock(hashtext('rhiza:workspace-write:' || $1))", [this.defaultWorkspaceId]);
      const workspace = await this.readFrom(database, true);
      if (!workspace) throw new Error('Workspace is unavailable');
      await database.query('DELETE FROM context_candidate_index WHERE workspace_id=$1', [this.defaultWorkspaceId]);
      await database.query('DELETE FROM context_candidate_heads WHERE workspace_id=$1', [this.defaultWorkspaceId]);
      return materializeContextCandidates(database, workspace);
    });
  }

  async readGraphProjection() { return this.materializeGraph(false); }

  async rebuildGraphProjection() { return this.materializeGraph(true); }

  private async materializeGraph(force: boolean) {
    await this.read();
    return this.inTransaction(async database => {
      // Use the command lock so Current State, Run records and Journal head form one snapshot.
      await database.query("SELECT pg_advisory_xact_lock(hashtext('rhiza:workspace-write:' || $1))", [this.defaultWorkspaceId]);
      const workspace = await this.readFrom(database, true);
      if (!workspace) throw new Error('Workspace is unavailable');
      const runs = await database.query<{ record: ExecutionRun; input_content_ref: unknown }>('SELECT record,input_content_ref FROM execution_runs WHERE workspace_id=$1', [this.defaultWorkspaceId]);
      const sequence = await database.query<{ sequence: number }>('SELECT COALESCE(MAX(sequence),0)::bigint AS sequence FROM workspace_events WHERE workspace_id=$1', [this.defaultWorkspaceId]);
      // Removal history must survive more than the activity endpoint's 10k-event window.
      const removed = await database.query<Record<string, unknown>>("SELECT * FROM workspace_events WHERE workspace_id=$1 AND event_type IN ('object.purged','graph.relation.removed') ORDER BY sequence", [this.defaultWorkspaceId]);
      const events = await Promise.all(removed.rows.map(row => this.decodeJournalEvent(row)));
      const projection = buildWorkspaceGraphProjection(workspace, await Promise.all(runs.rows.map(row => this.decodeRun(row))), Number(sequence.rows[0]?.sequence ?? 0), events);
      return new PostgresGraphProjectionAdapter({ query: database.query.bind(database), transaction: work => work(database) }, this.defaultWorkspaceId).materialize(projection, force);
    });
  }

  private async readReceiptResult<T>(row: Record<string, unknown>, kind: 'result' | 'error' = 'result'): Promise<T> {
    const reference = row[`${kind}_content_ref`];
    if (reference !== null && reference !== undefined) {
      if (!this.receiptContent) throw new Error('RECEIPT_CONTENT_STORE_UNAVAILABLE');
      return this.receiptContent.read<T>(String(row.workspace_id), String(row.command_id), asJson<SealedReceiptRef>(reference), kind);
    }
    return asJson<T>(row[kind]);
  }

  async readCommandReceipt(commandId: string): Promise<CommandReceipt | undefined> {
    const result = await this.database.query<Record<string, unknown>>('SELECT * FROM command_receipts WHERE workspace_id=$1 AND command_id=$2', [this.defaultWorkspaceId, commandId]);
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      workspaceId: String(row.workspace_id), commandId: String(row.command_id), commandType: String(row.command_type),
      status: row.status as CommandReceipt['status'], firstSequence: row.first_sequence === null ? undefined : Number(row.first_sequence),
      lastSequence: row.last_sequence === null ? undefined : Number(row.last_sequence), result: (await this.readReceiptResult(row)) ?? undefined,
      error: (await this.readReceiptResult(row, 'error')) ?? undefined, createdAt: asIso(row.created_at),
    };
  }

  async listWorkspaceIds(): Promise<string[]> {
    const result = await this.database.query<{ id: string }>('SELECT id FROM rhiza_projects ORDER BY id');
    return result.rows.map(row => String(row.id));
  }

  async backfillJournal(): Promise<{ checksum: string; created: boolean; eventCount: number }> {
    return this.inTransaction(async database => {
      await database.query("SELECT pg_advisory_xact_lock(hashtext('rhiza:journal-backfill:' || $1))", [this.defaultWorkspaceId]);
      await database.query("SELECT pg_advisory_xact_lock(hashtext('rhiza:workspace-write:' || $1))", [this.defaultWorkspaceId]);
      const workspace = await this.readFrom(database, true);
      if (!workspace) throw new Error(`Workspace ${this.defaultWorkspaceId} does not exist`);
      const checksum = semanticChecksum(workspace);
      const existing = await database.query<{ count: number }>('SELECT count(*)::int count FROM workspace_events WHERE workspace_id=$1', [this.defaultWorkspaceId]);
      const eventCount = Number(existing.rows[0]?.count || 0);
      const baseline = await database.query<Record<string, unknown>>("SELECT * FROM workspace_events WHERE workspace_id=$1 AND sequence=1 AND event_type IN ('workspace.baseline.backfilled','workspace.created')", [this.defaultWorkspaceId]);
      if (baseline.rows[0] && (await this.decodeJournalEvent(baseline.rows[0])).payload.snapshot != null) return { checksum, created: false, eventCount };
      if (eventCount > 0) throw Object.assign(new Error(`Workspace ${this.defaultWorkspaceId} has Journal events but no sequence-1 baseline`), { code: 'JOURNAL_BASELINE_ORDER_CONFLICT', status: 409 });
      const sequence = 1;
      await database.query('INSERT INTO workspace_event_heads (workspace_id,last_sequence) VALUES ($1,$2) ON CONFLICT (workspace_id) DO NOTHING', [this.defaultWorkspaceId, sequence]);
      const commandId = 'backfill:workspace-baseline:v1';
      const occurredAt = workspace.updatedAt;
      const payload = {
        checksum,
        snapshot: { stateSchema: 'rhiza.workspace-semantic.v1', sourceSequence: 0, state: workspaceSemanticSnapshot(workspace) },
        counts: {
          nodes: workspace.discussionNodes.length, messages: workspace.messages.length, manifests: workspace.manifests.length,
          resources: workspace.resources.length, resourceVersions: workspace.resourceVersions.length,
        },
      };
      const eventId = randomUUID();
      const sealed = await this.prepareJournalPayload(database, this.defaultWorkspaceId, eventId, payload);
      await database.query(`
        INSERT INTO workspace_events
          (event_id,workspace_id,sequence,ce_specversion,rhiza_envelope_version,event_type,event_source,subject,data_schema,aggregate_type,aggregate_id,aggregate_revision,actor_ref,scope_ref,command_id,event_index,payload,occurred_at,payload_content_ref)
        VALUES ($1,$2::uuid,1,'1.0',$3,'workspace.baseline.backfilled',$4,$5,$6,'workspace',$2::text,0,$7::jsonb,$8::jsonb,$9,0,$10::jsonb,$11,$12::jsonb)
      `, [eventId, this.defaultWorkspaceId, DOMAIN_EVENT_SCHEMA_VERSION,
        journalSource(this.defaultWorkspaceId), journalSubject('workspace', this.defaultWorkspaceId), journalDataSchema('workspace.baseline.backfilled'),
        JSON.stringify({ actorType: 'system', actorId: 'journal-backfill-v1' }),
        JSON.stringify({ scopeType: 'workspace', scopeId: this.defaultWorkspaceId }), commandId, sealed.payload, occurredAt, sealed.reference]);
      await this.insertCommittedReceipt(database, this.defaultWorkspaceId, commandId, 'BackfillWorkspaceBaseline', 1, 1, { checksum });
      return { checksum, created: true, eventCount: 1 };
    });
  }

  private async decodeMessage(row: Record<string, unknown>, attachmentIds: string[]): Promise<StoredMessage> {
    const message = storedMessage(row, attachmentIds);
    if (row.content_ref == null) return message;
    if (!this.messageContent) throw new Error('MESSAGE_CONTENT_STORE_UNAVAILABLE');
    return { ...message, ...await this.messageContent.read(this.defaultWorkspaceId, message.id, asJson<SealedMessageRef>(row.content_ref)) };
  }

  private async readFrom(database: SqlQueryable, lock = false): Promise<WorkspaceData | undefined> {
    const projects = await database.query<{ id: string; title: string; active_node_id: string | null; state: unknown; updated_at: unknown }>(`SELECT id, title, active_node_id, state, updated_at FROM rhiza_projects WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [this.defaultWorkspaceId]);
    const project = projects.rows[0];
    if (!project) return undefined;
    const [nodesResult, segmentsResult, messagesResult, anchorsResult, edgesResult, manifestsResult, attachmentsResult, resourcesResult, resourceVersionsResult, materializationsResult, messageAttachmentsResult, auditResult, layoutResult] = await Promise.all([
      database.query<Record<string, unknown>>('SELECT * FROM rhiza_nodes WHERE project_id = $1 ORDER BY created_at, id', [project.id]),
      database.query<Record<string, unknown>>('SELECT s.* FROM rhiza_segments s JOIN rhiza_nodes n ON n.id = s.node_id WHERE n.project_id = $1 ORDER BY s.node_id, s.ordinal', [project.id]),
      database.query<Record<string, unknown>>('SELECT m.* FROM rhiza_messages m JOIN rhiza_nodes n ON n.id = m.node_id WHERE n.project_id = $1 ORDER BY m.event_ordinal, m.id', [project.id]),
      database.query<Record<string, unknown>>('SELECT * FROM rhiza_anchors WHERE project_id = $1 ORDER BY created_at, id', [project.id]),
      database.query<Record<string, unknown>>('SELECT * FROM rhiza_edges WHERE project_id = $1 ORDER BY created_at, id', [project.id]),
      database.query<Record<string, unknown>>('SELECT * FROM rhiza_context_manifests WHERE project_id = $1 ORDER BY created_at, id', [project.id]),
      database.query<Record<string, unknown>>('SELECT * FROM rhiza_attachments WHERE project_id = $1 ORDER BY created_at, id', [project.id]),
      database.query<Record<string, unknown>>('SELECT * FROM rhiza_resources WHERE workspace_id = $1 ORDER BY created_at, resource_id', [project.id]),
      database.query<Record<string, unknown>>('SELECT rv.* FROM rhiza_resource_versions rv JOIN rhiza_resources r ON r.resource_id=rv.resource_id WHERE r.workspace_id=$1 ORDER BY rv.resource_id,rv.version', [project.id]),
      database.query<Record<string, unknown>>('SELECT rm.* FROM rhiza_resource_materializations rm JOIN rhiza_resource_versions rv ON rv.resource_version_id=rm.resource_version_id JOIN rhiza_resources r ON r.resource_id=rv.resource_id WHERE r.workspace_id=$1 ORDER BY rm.created_at,rm.materialization_id', [project.id]),
      database.query<{ message_id: string; attachment_id: string; ordinal: number }>('SELECT ma.* FROM rhiza_message_attachments ma JOIN rhiza_messages m ON m.id = ma.message_id JOIN rhiza_nodes n ON n.id = m.node_id WHERE n.project_id = $1 ORDER BY ma.message_id, ma.ordinal', [project.id]),
      database.query<Record<string, unknown>>('SELECT * FROM rhiza_audit_events WHERE project_id = $1 ORDER BY created_at, id', [project.id]),
      database.query<Record<string, unknown>>("SELECT object_id,x,y FROM graph_layout_nodes WHERE workspace_id=$1 AND layout_id='default' AND object_type='conversation'", [project.id]),
    ]);
    const attachmentIds = new Map<string, string[]>();
    for (const row of messageAttachmentsResult.rows) attachmentIds.set(row.message_id, [...(attachmentIds.get(row.message_id) || []), row.attachment_id]);
    const layouts = new Map(layoutResult.rows.map(row => [String(row.object_id), { x: Number(row.x), y: Number(row.y) }]));
    const nodes: DiscussionNode[] = nodesResult.rows.map(row => ({ id: String(row.id), title: String(row.title), summary: String(row.summary), status: row.status as DiscussionNode['status'], kind: row.kind as DiscussionNode['kind'], sourceNodeId: row.source_node_id ? String(row.source_node_id) : undefined, sourceMessageId: row.source_message_id ? String(row.source_message_id) : undefined, anchorText: row.anchor_text ? String(row.anchor_text) : undefined, x: layouts.get(String(row.id))?.x ?? Number(row.position_x), y: layouts.get(String(row.id))?.y ?? Number(row.position_y), createdAt: asIso(row.created_at), updatedAt: asIso(row.updated_at) }));
    const messages = await Promise.all(messagesResult.rows.map(row => this.decodeMessage(row, attachmentIds.get(String(row.id)) || [])));
    const state = asJson<{ mode?: WorkspaceData['mode']; contextItems?: WorkspaceData['contextItems']; fileChunks?: FileChunk[] }>(project.state || {});
    return {
      projectId: project.id, projectTitle: project.title, nodeId: project.active_node_id || nodes[0]?.id || '', activeNodeId: project.active_node_id || nodes[0]?.id || '',
      mode: state.mode || 'Assisted', contextItems: state.contextItems || [], discussionNodes: nodes, messages,
      segments: segmentsResult.rows.map(row => ({ id: String(row.id), nodeId: String(row.node_id), ordinal: Number(row.ordinal), title: String(row.title), createdAt: asIso(row.created_at) } satisfies Segment)),
      anchors: anchorsResult.rows.map(row => ({ id: String(row.id), nodeId: String(row.node_id), messageId: row.message_id ? String(row.message_id) : undefined, segmentId: row.segment_id ? String(row.segment_id) : undefined, selectedText: row.selected_text ? String(row.selected_text) : undefined, startOffset: row.start_offset === null ? undefined : Number(row.start_offset), endOffset: row.end_offset === null ? undefined : Number(row.end_offset), createdAt: asIso(row.created_at) } satisfies Anchor)),
      discussionEdges: edgesResult.rows.map(row => ({ id: String(row.id), source: String(row.source_node_id), target: String(row.target_node_id), relation: relationFromDb(String(row.relation)), anchorId: row.anchor_id ? String(row.anchor_id) : undefined, label: String(row.label), createdAt: asIso(row.created_at) })),
      manifests: manifestsResult.rows.map(row => asJson<ContextManifest>(row.manifest)),
      attachments: attachmentsResult.rows.map(row => {
        const version = resourceVersionsResult.rows.find(item => String(item.resource_version_id) === String(row.resource_version_id));
        return storedAttachment({ ...row, digest: version?.digest, blob_ref: version?.blob_ref });
      }),
      resources: resourcesResult.rows.map(row => ({ id: String(row.resource_id), workspaceId: String(row.workspace_id), kind: row.kind as Resource['kind'], logicalName: String(row.logical_name), createdAt: asIso(row.created_at) })),
      resourceVersions: resourceVersionsResult.rows.map(storedResourceVersion),
      materializations: materializationsResult.rows.map(row => ({ id: String(row.materialization_id), resourceVersionId: String(row.resource_version_id), kind: row.kind as ResourceMaterialization['kind'], generator: row.generator as ResourceMaterialization['generator'], createdAt: asIso(row.created_at) })),
      fileChunks: state.fileChunks || [],
      auditEvents: auditResult.rows.map(row => ({ id: String(row.id), projectId: String(row.project_id), nodeId: row.node_id ? String(row.node_id) : undefined, action: String(row.action), entityType: row.entity_type as AuditEvent['entityType'], entityId: String(row.entity_id), metadata: asJson(row.metadata), createdAt: asIso(row.created_at) })),
      updatedAt: asIso(project.updated_at),
    };
  }

  private async persist(database: SqlQueryable, workspace: WorkspaceData, previous?: WorkspaceData, options?: WorkspaceUpdateOptions): Promise<void> {
    if (options?.purge) {
      const nodeId = options.purge.nodeId;
      const sealedRuns = await database.query<{ record: ExecutionRun; input_content_ref: unknown }>('SELECT record,input_content_ref FROM execution_runs WHERE workspace_id=$1 AND input_content_ref IS NOT NULL', [workspace.projectId]);
      let sealedReference = false;
      for (const row of sealedRuns.rows) {
        const run = await this.decodeRun(row);
        if (run.nodeId === nodeId || run.nodeId === `temp:${nodeId}`
          || run.input.request.history.some(item => item.nodeId === nodeId)
          || run.input.request.contextItems.some(item => item.sourceNodeId === nodeId || (item.sourceType === 'node' && item.sourceId === nodeId))) {
          sealedReference = true;
          break;
        }
      }
      const retained = await database.query(`SELECT run_id FROM execution_runs WHERE workspace_id=$1 AND (
        node_id=$2 OR node_id='temp:' || $2 OR input_envelope->'request'->'history' @> $3::jsonb
        OR input_envelope->'request'->'contextItems' @> $4::jsonb OR input_envelope->'request'->'contextItems' @> $5::jsonb) LIMIT 1`,
        [workspace.projectId, nodeId, JSON.stringify([{ nodeId }]), JSON.stringify([{ sourceNodeId: nodeId }]), JSON.stringify([{ sourceType: 'node', sourceId: nodeId }])]);
      if (sealedReference || retained.rows.length) throw Object.assign(new Error('该节点仍被不可变执行历史引用，请使用归档；物理删除需要统一的执行历史清理策略。'), { code: 'PURGE_HAS_EXECUTION_HISTORY', status: 409 });
    }
    const nodes = changedItems(workspace.discussionNodes, previous?.discussionNodes);
    const segments = changedItems(workspace.segments, previous?.segments);
    const manifests = changedItems(workspace.manifests, previous?.manifests);
    const attachments = changedItems(workspace.attachments, previous?.attachments);
    const resources = changedItems(workspace.resources, previous?.resources);
    const resourceVersions = changedItems(workspace.resourceVersions, previous?.resourceVersions);
    const materializations = changedItems(workspace.materializations, previous?.materializations);
    const messages = changedItems(workspace.messages, previous?.messages);
    const anchors = changedItems(workspace.anchors, previous?.anchors);
    const edges = changedItems(workspace.discussionEdges, previous?.discussionEdges);
    const audits = changedItems(workspace.auditEvents, previous?.auditEvents);
    await database.query(`INSERT INTO rhiza_projects (id, title, state, created_at, updated_at) VALUES ($1,$2,$3::jsonb,$4,$4) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, state=EXCLUDED.state, updated_at=EXCLUDED.updated_at`, [workspace.projectId, workspace.projectTitle, JSON.stringify({ mode: workspace.mode, contextItems: workspace.contextItems, fileChunks: workspace.fileChunks }), workspace.updatedAt]);
    await database.query(`INSERT INTO graph_layouts (workspace_id,layout_id,owner_scope) VALUES ($1,'default',$2::jsonb) ON CONFLICT DO NOTHING`, [workspace.projectId, JSON.stringify({ scopeType: 'workspace', scopeId: workspace.projectId })]);
    for (const node of nodes) {
      await database.query(`INSERT INTO rhiza_nodes (id,project_id,title,summary,status,kind,position_x,position_y,created_at,updated_at,anchor_text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,summary=EXCLUDED.summary,status=EXCLUDED.status,kind=EXCLUDED.kind,updated_at=EXCLUDED.updated_at,anchor_text=EXCLUDED.anchor_text`, [node.id,workspace.projectId,node.title,node.summary,node.status,node.kind,node.x,node.y,node.createdAt,node.updatedAt,node.anchorText || null]);
      await database.query(`INSERT INTO graph_layout_nodes (workspace_id,layout_id,object_type,object_id,x,y) VALUES ($1,'default','conversation',$2,$3,$4) ON CONFLICT (workspace_id,layout_id,object_type,object_id) DO UPDATE SET x=EXCLUDED.x,y=EXCLUDED.y`, [workspace.projectId,node.id,node.x,node.y]);
    }
    for (const segment of segments) await database.query(`INSERT INTO rhiza_segments (id,node_id,ordinal,title,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET node_id=EXCLUDED.node_id,ordinal=EXCLUDED.ordinal,title=EXCLUDED.title`, [segment.id,segment.nodeId,segment.ordinal,segment.title,segment.createdAt]);
    for (const resource of resources) await database.query(`INSERT INTO rhiza_resources (resource_id,workspace_id,kind,logical_name,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (resource_id) DO NOTHING`, [resource.id,resource.workspaceId,resource.kind,resource.logicalName,resource.createdAt]);
    for (const version of resourceVersions) await database.query(`INSERT INTO rhiza_resource_versions (resource_version_id,resource_id,version,digest_algorithm,digest,canonicalization,media_type,size_bytes,blob_ref,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [version.id,version.resourceId,version.version,version.digestAlgorithm,version.digest,version.canonicalization,version.mediaType,version.size,version.blobRef,version.createdAt]);
    for (const manifest of manifests) await database.query(`INSERT INTO rhiza_context_manifests (id,project_id,node_id,request_id,mode,provider,model,runtime,estimated_tokens,manifest,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`, [manifest.id,workspace.projectId,manifest.nodeId,manifest.requestId,manifest.mode,manifest.provider,manifest.model,manifest.runtime,manifest.estimatedTokens,JSON.stringify(manifest),manifest.createdAt]);
    for (const materialization of materializations) await database.query(`INSERT INTO rhiza_resource_materializations (materialization_id,resource_version_id,kind,generator,created_at) VALUES ($1,$2,$3,$4,$5)`, [materialization.id,materialization.resourceVersionId,materialization.kind,materialization.generator,materialization.createdAt]);
    for (const attachment of attachments) await database.query(`INSERT INTO rhiza_attachments (id,project_id,name,mime_type,size_bytes,kind,storage_key,extracted_text,created_at,resource_id,resource_version_id,summary,chunk_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,mime_type=EXCLUDED.mime_type,size_bytes=EXCLUDED.size_bytes,kind=EXCLUDED.kind,extracted_text=EXCLUDED.extracted_text,resource_id=EXCLUDED.resource_id,resource_version_id=EXCLUDED.resource_version_id,summary=EXCLUDED.summary,chunk_count=EXCLUDED.chunk_count`, [attachment.id,workspace.projectId,attachment.name,attachment.mimeType,attachment.size,attachment.kind,attachment.blobRef || attachment.id,attachment.extractedText || null,attachment.createdAt,attachment.resourceId || null,attachment.resourceVersionId || null,attachment.summary || null,attachment.chunkCount ?? null]);
    for (const message of messages) {
      let reference: SealedMessageRef | undefined;
      if (this.messageContent) {
        const pending = this.transactionContent.get(database);
        if (!pending) throw new Error('MESSAGE_CONTENT_REQUIRES_TRANSACTION');
        reference = await this.messageContent.seal(workspace.projectId, message.id, message);
        pending.push({ workspaceId: workspace.projectId, messageId: message.id, reference });
      }
      await database.query(`INSERT INTO rhiza_messages (id,node_id,segment_id,kind,body,manifest_id,created_at,operation,version_group_id,version,usage,reasoning,tool_calls,content_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb,$14::jsonb) ON CONFLICT (id) DO UPDATE SET segment_id=EXCLUDED.segment_id,body=EXCLUDED.body,manifest_id=EXCLUDED.manifest_id,operation=EXCLUDED.operation,version_group_id=EXCLUDED.version_group_id,version=EXCLUDED.version,usage=EXCLUDED.usage,reasoning=EXCLUDED.reasoning,tool_calls=EXCLUDED.tool_calls,content_ref=EXCLUDED.content_ref`, [message.id,message.nodeId,message.segmentId || null,message.kind,reference ? '' : message.text,message.manifestId || null,message.createdAt,message.operation || 'send',message.versionGroupId || null,message.version || 1,JSON.stringify(message.usage || null),reference ? null : message.reasoning || null,reference ? null : JSON.stringify(message.toolCalls || null),reference ? JSON.stringify(reference) : null]);
    }
    for (const node of nodes) await database.query('UPDATE rhiza_nodes SET source_node_id=$2, source_message_id=$3 WHERE id=$1', [node.id,node.sourceNodeId || null,node.sourceMessageId || null]);
    for (const message of messages) await database.query('UPDATE rhiza_messages SET source_message_id=$2, reply_to_message_id=$3 WHERE id=$1', [message.id,message.sourceMessageId || null,message.replyToMessageId || null]);
    for (const anchor of anchors) await database.query(`INSERT INTO rhiza_anchors (id,project_id,node_id,message_id,segment_id,selected_text,start_offset,end_offset,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE SET node_id=EXCLUDED.node_id,message_id=EXCLUDED.message_id,segment_id=EXCLUDED.segment_id,selected_text=EXCLUDED.selected_text,start_offset=EXCLUDED.start_offset,end_offset=EXCLUDED.end_offset`, [anchor.id,workspace.projectId,anchor.nodeId,anchor.messageId || null,anchor.segmentId || null,anchor.selectedText || null,anchor.startOffset ?? null,anchor.endOffset ?? null,anchor.createdAt]);
    for (const edge of edges) await database.query(`INSERT INTO rhiza_edges (id,project_id,source_node_id,target_node_id,anchor_id,relation,label,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET source_node_id=EXCLUDED.source_node_id,target_node_id=EXCLUDED.target_node_id,anchor_id=EXCLUDED.anchor_id,relation=EXCLUDED.relation,label=EXCLUDED.label`, [edge.id,workspace.projectId,edge.source,edge.target,edge.anchorId || null,relationToDb(edge.relation),edge.label,edge.createdAt]);
    if (messages.length) await database.query('DELETE FROM rhiza_message_attachments WHERE message_id = ANY($1::uuid[])', [messages.map(message => message.id)]);
    for (const message of messages) for (const [ordinal, attachmentId] of (message.attachmentIds || []).entries()) await database.query('INSERT INTO rhiza_message_attachments (message_id,attachment_id,ordinal) VALUES ($1,$2,$3)', [message.id,attachmentId,ordinal]);
    for (const audit of audits) await database.query(`INSERT INTO rhiza_audit_events (id,project_id,node_id,action,entity_type,entity_id,metadata,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT (id) DO NOTHING`, [audit.id,audit.projectId,audit.nodeId || null,audit.action,audit.entityType,audit.entityId,JSON.stringify(audit.metadata),audit.createdAt]);
    await database.query('UPDATE rhiza_projects SET active_node_id=$2 WHERE id=$1', [workspace.projectId, workspace.activeNodeId]);
    await this.deleteMissing(database, workspace, options);
    await materializeContextCandidates(database, workspace, previous);
    await this.persistProvenance(database, workspace, messages);
  }

  private async persistProvenance(database: SqlQueryable, workspace: WorkspaceData, messages: StoredMessage[]): Promise<number> {
    let inserted = 0;
    for (const output of messages.filter(message => message.kind === 'assistant')) {
      const node = workspace.discussionNodes.find(node => node.id === output.nodeId)!;
      const manifest = workspace.manifests.find(manifest => manifest.id === output.manifestId);
      const runs = manifest ? await database.query<{ record: ExecutionRun; input_content_ref: unknown }>('SELECT record,input_content_ref FROM execution_runs WHERE workspace_id=$1 AND run_id=$2', [workspace.projectId, manifest.requestId]) : { rows: [] };
      const link = deriveProvenance(workspace.projectId, output, node, manifest, runs.rows[0] ? await this.decodeRun(runs.rows[0]) : undefined);
      const result = await database.query('INSERT INTO provenance_links (workspace_id,output_ref,provenance_id,record) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (workspace_id,output_ref) DO NOTHING RETURNING output_ref', [workspace.projectId, output.id, link.id, JSON.stringify(link)]);
      inserted += result.rows.length;
    }
    return inserted;
  }

  private async deleteMissing(database: SqlQueryable, workspace: WorkspaceData, options?: WorkspaceUpdateOptions) {
    await database.query('DELETE FROM rhiza_edges WHERE project_id=$1 AND NOT (id = ANY($2::uuid[]))', [workspace.projectId, workspace.discussionEdges.map(item => item.id)]);
    await database.query('DELETE FROM rhiza_anchors WHERE project_id=$1 AND NOT (id = ANY($2::uuid[]))', [workspace.projectId, workspace.anchors.map(item => item.id)]);
    await database.query('DELETE FROM rhiza_segments WHERE node_id IN (SELECT id FROM rhiza_nodes WHERE project_id=$1) AND NOT (id = ANY($2::uuid[]))', [workspace.projectId, workspace.segments.map(item => item.id)]);
    await database.query('DELETE FROM rhiza_attachments WHERE project_id=$1 AND NOT (id = ANY($2::uuid[]))', [workspace.projectId, workspace.attachments.map(item => item.id)]);
    if (options?.purge) {
      await database.query("SELECT set_config('rhiza.purge_context_manifest_delete', 'on', true)");
      await database.query('DELETE FROM rhiza_nodes WHERE project_id=$1 AND id=$2', [workspace.projectId, options.purge.nodeId]);
    }
  }
}
