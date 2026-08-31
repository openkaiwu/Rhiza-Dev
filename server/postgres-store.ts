import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
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

interface QueryResult<Row> { rows: Row[] }
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
  private runtimeOwner?: SqlQueryable & { release(): void };
  private queue: Promise<void> = Promise.resolve();
  private readonly scoped = new Map<string, PostgresWorkspaceStore>();

  constructor(private readonly database: TransactionalSql, readonly defaultWorkspaceId = DEFAULT_PROJECT_ID) {}

  forWorkspace(workspaceId: string): WorkspaceRepository {
    if (workspaceId === this.defaultWorkspaceId) return this;
    let scoped = this.scoped.get(workspaceId);
    if (!scoped) { scoped = new PostgresWorkspaceStore(this.database, workspaceId); this.scoped.set(workspaceId, scoped); }
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

  static fromConnectionString(connectionString: string, projectId?: string) {
    return new PostgresWorkspaceStore(new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 }), projectId);
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
    if (this.database.transaction) return this.database.transaction(callback);
    if (!this.database.connect) throw new Error('PostgreSQL adapter does not support transactions');
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
          const rejection = asJson<{ message: string; code: string; status: number }>(receipt.rows[0].error);
          throw Object.assign(new Error(rejection.message), rejection, { storedReceipt: true });
        }
        return asJson<WorkspaceRecord>(receipt.rows[0].result);
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
      await database.query(`
        INSERT INTO workspace_events
          (event_id,workspace_id,sequence,ce_specversion,rhiza_envelope_version,event_type,event_source,subject,data_schema,aggregate_type,aggregate_id,aggregate_revision,actor_ref,scope_ref,command_id,event_index,causation_id,correlation_id,payload,occurred_at)
        VALUES ($1,$2::uuid,$3,'1.0',$4,$5,$6,$7,$8,'workspace',$2::text,$9,$10::jsonb,$11::jsonb,$12,0,$13,$14,$15::jsonb,$16)
      `, [randomUUID(), command.workspaceId, sequence, DOMAIN_EVENT_SCHEMA_VERSION, eventType,
        journalSource(command.workspaceId), journalSubject('workspace', command.workspaceId), journalDataSchema(eventType), record.revision,
        JSON.stringify(context.actor), JSON.stringify({ scopeType: 'workspace', scopeId: command.workspaceId }), context.commandId,
        context.causationId || null, context.correlationId || null, JSON.stringify(lifecyclePayload), context.occurredAt]);
      await database.query(`
        INSERT INTO command_receipts (workspace_id,command_id,command_type,status,first_sequence,last_sequence,result)
        VALUES ($1,$2,$3,'committed',$4,$4,$5::jsonb)
      `, [command.workspaceId, context.commandId, context.commandType, sequence, JSON.stringify(record)]);
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
          const rejection = asJson<{ message: string; code: string; status: number }>(receipt.error);
          throw Object.assign(new Error(rejection.message), rejection, { storedReceipt: true });
        }
        const workspace = await this.readFrom(database, true);
        if (!workspace) throw new Error(`Committed receipt exists without Workspace state for ${this.defaultWorkspaceId}`);
        return { workspace, value: asJson<T>(receipt.result), duplicate: true };
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
        await database.query(`
          INSERT INTO workspace_events
            (event_id,workspace_id,sequence,ce_specversion,rhiza_envelope_version,event_type,event_source,subject,data_schema,aggregate_type,aggregate_id,aggregate_revision,actor_ref,scope_ref,command_id,event_index,causation_id,correlation_id,payload,occurred_at)
          VALUES ($1,$2,$3,'1.0',$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18::jsonb,$19)
        `, [randomUUID(), this.defaultWorkspaceId, firstSequence + offset, DOMAIN_EVENT_SCHEMA_VERSION, event.eventType,
          journalSource(this.defaultWorkspaceId), journalSubject(event.aggregateType, event.aggregateId), journalDataSchema(event.eventType),
          event.aggregateType, event.aggregateId, aggregateRevision, JSON.stringify(command.context.actor), JSON.stringify(command.context.scope),
          command.context.commandId, offset, command.context.causationId || null, command.context.correlationId || null,
          JSON.stringify({ ...event.payload, reconcileChecksum: semanticChecksum(next), stateSchema: 'rhiza.workspace-semantic.v1', ...(offset === events.length - 1 ? { stateChanges: workspaceSemanticChanges(current, next) } : {}) }), command.context.occurredAt]);
      }
      await database.query(`
        INSERT INTO command_receipts
          (workspace_id,command_id,command_type,status,first_sequence,last_sequence,result)
        VALUES ($1,$2,$3,'committed',$4,$5,$6::jsonb)
      `, [this.defaultWorkspaceId, command.context.commandId, command.context.commandType, firstSequence, lastSequence, JSON.stringify(result.value ?? null)]);
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
        const code = String(candidate.details?.code ?? candidate.code ?? 'COMMAND_REJECTED');
        await database.query(`
          INSERT INTO command_receipts (workspace_id,command_id,command_type,status,error)
          SELECT id,$2,$3,'rejected',$4::jsonb FROM rhiza_projects WHERE id=$1
          ON CONFLICT (workspace_id,command_id) DO NOTHING
        `, [this.defaultWorkspaceId, context.commandId, context.commandType, JSON.stringify({ message: candidate.message || 'Command rejected', code, status })]);
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

  async listRuns(limit = 50): Promise<ExecutionRun[]> {
    const result = await this.database.query<{ record: ExecutionRun }>(`SELECT record FROM execution_runs WHERE workspace_id=$1 ORDER BY record->>'createdAt' DESC, run_id LIMIT $2`, [this.defaultWorkspaceId, Math.min(10000, Math.max(1, limit))]);
    return result.rows.map(row => asJson<ExecutionRun>(row.record));
  }

  async getRun(runId: string): Promise<ExecutionRun | undefined> {
    const result = await this.database.query<{ record: ExecutionRun }>('SELECT record FROM execution_runs WHERE workspace_id=$1 AND run_id=$2', [this.defaultWorkspaceId, runId]);
    return result.rows[0] ? asJson<ExecutionRun>(result.rows[0].record) : undefined;
  }

  async writeRunTraces(runId: string, attempt: number, traces: RunTrace[]) {
    await this.database.query(`INSERT INTO execution_run_traces (run_id,attempt,sequence,record)
      SELECT r.run_id,$3,(t->>'sequence')::int,t FROM execution_runs r, jsonb_array_elements($4::jsonb) t
      WHERE r.workspace_id=$1 AND r.run_id=$2 AND r.attempt=$3
      ON CONFLICT (run_id,attempt,sequence) DO NOTHING`, [this.defaultWorkspaceId, runId, attempt, JSON.stringify(traces)]);
  }

  private async applyRunMutation(database: SqlQueryable, mutation: RunMutation) {
    if (mutation.kind === 'create') {
      const run = mutation.run;
      if (run.workspaceId !== this.defaultWorkspaceId || run.status !== 'created' || semanticStateChecksum(run.input as unknown as Record<string, unknown>) !== run.inputHash) throw new Error('Invalid ExecutionRun input');
      await database.query(`INSERT INTO execution_runs
        (run_id,workspace_id,command_id,node_id,status,attempt,parent_run_ref,input_envelope,input_hash,model_spec_ref,provider_endpoint_ref,record)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12::jsonb)`,
        [run.id,run.workspaceId,run.commandId,run.nodeId,run.status,run.attempt,run.parentRunRef ?? null,JSON.stringify(run.input),run.inputHash,run.input.executor.modelSpecRef,run.input.executor.providerEndpointRef,JSON.stringify(run)]);
      return;
    }
    const result = await database.query(`UPDATE execution_runs SET status=$4,record=record || $5::jsonb
      WHERE workspace_id=$1 AND run_id=$2 AND attempt=$3 AND status=ANY($6::text[]) RETURNING run_id`,
      [this.defaultWorkspaceId,mutation.runId,mutation.attempt,mutation.patch.status,JSON.stringify(mutation.patch),mutation.from]);
    if (!result.rows.length) throw Object.assign(new Error('执行已终止或状态已变化，迟到结果未写入。'), { code: 'RUN_STATE_CONFLICT', status: 409 });
  }

  async readJournal(limit = 50): Promise<DomainEventEnvelope[]> {
    const result = await this.database.query<Record<string, unknown>>(`
      SELECT * FROM workspace_events WHERE workspace_id=$1 ORDER BY sequence DESC LIMIT $2
    `, [this.defaultWorkspaceId, Math.min(100, Math.max(1, limit))]);
    return result.rows.map(row => ({
      eventId: String(row.event_id), workspaceId: String(row.workspace_id), sequence: Number(row.sequence),
      eventType: String(row.event_type) as DomainEventEnvelope['eventType'], ceSpecversion: '1.0', envelopeVersion: DOMAIN_EVENT_SCHEMA_VERSION,
      eventSource: String(row.event_source), subject: String(row.subject), dataSchema: String(row.data_schema),
      aggregateType: String(row.aggregate_type), aggregateId: String(row.aggregate_id), aggregateRevision: Number(row.aggregate_revision), actor: asJson(row.actor_ref), scope: asJson(row.scope_ref),
      commandId: String(row.command_id), eventIndex: Number(row.event_index), causationId: row.causation_id ? String(row.causation_id) : undefined, correlationId: row.correlation_id ? String(row.correlation_id) : undefined,
      payload: asJson(row.payload), occurredAt: asIso(row.occurred_at), recordedAt: asIso(row.recorded_at),
    }));
  }

  async readCommandReceipt(commandId: string): Promise<CommandReceipt | undefined> {
    const result = await this.database.query<Record<string, unknown>>('SELECT * FROM command_receipts WHERE workspace_id=$1 AND command_id=$2', [this.defaultWorkspaceId, commandId]);
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      workspaceId: String(row.workspace_id), commandId: String(row.command_id), commandType: String(row.command_type),
      status: row.status as CommandReceipt['status'], firstSequence: row.first_sequence === null ? undefined : Number(row.first_sequence),
      lastSequence: row.last_sequence === null ? undefined : Number(row.last_sequence), result: row.result === null ? undefined : asJson(row.result),
      error: row.error === null ? undefined : asJson(row.error), createdAt: asIso(row.created_at),
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
      const existing = await database.query<{ count: number; baseline_count: number }>("SELECT count(*)::int count,count(*) FILTER (WHERE sequence=1 AND event_type IN ('workspace.baseline.backfilled','workspace.created') AND payload->'snapshot' IS NOT NULL)::int baseline_count FROM workspace_events WHERE workspace_id=$1", [this.defaultWorkspaceId]);
      const eventCount = Number(existing.rows[0]?.count || 0);
      if (Number(existing.rows[0]?.baseline_count || 0) === 1) return { checksum, created: false, eventCount };
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
      await database.query(`
        INSERT INTO workspace_events
          (event_id,workspace_id,sequence,ce_specversion,rhiza_envelope_version,event_type,event_source,subject,data_schema,aggregate_type,aggregate_id,aggregate_revision,actor_ref,scope_ref,command_id,event_index,payload,occurred_at)
        VALUES ($1,$2::uuid,1,'1.0',$3,'workspace.baseline.backfilled',$4,$5,$6,'workspace',$2::text,0,$7::jsonb,$8::jsonb,$9,0,$10::jsonb,$11)
      `, [randomUUID(), this.defaultWorkspaceId, DOMAIN_EVENT_SCHEMA_VERSION,
        journalSource(this.defaultWorkspaceId), journalSubject('workspace', this.defaultWorkspaceId), journalDataSchema('workspace.baseline.backfilled'),
        JSON.stringify({ actorType: 'system', actorId: 'journal-backfill-v1' }),
        JSON.stringify({ scopeType: 'workspace', scopeId: this.defaultWorkspaceId }), commandId, JSON.stringify(payload), occurredAt]);
      await database.query(`
        INSERT INTO command_receipts (workspace_id,command_id,command_type,status,first_sequence,last_sequence,result)
        VALUES ($1,$2,'BackfillWorkspaceBaseline','committed',1,1,$3::jsonb)
      `, [this.defaultWorkspaceId, commandId, JSON.stringify({ checksum })]);
      return { checksum, created: true, eventCount: 1 };
    });
  }

  private async readFrom(database: SqlQueryable, lock = false): Promise<WorkspaceData | undefined> {
    const projects = await database.query<{ id: string; title: string; active_node_id: string | null; state: unknown; updated_at: unknown }>(`SELECT id, title, active_node_id, state, updated_at FROM rhiza_projects WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [this.defaultWorkspaceId]);
    const project = projects.rows[0];
    if (!project) return undefined;
    const [nodesResult, segmentsResult, messagesResult, anchorsResult, edgesResult, manifestsResult, attachmentsResult, resourcesResult, resourceVersionsResult, materializationsResult, messageAttachmentsResult, auditResult] = await Promise.all([
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
    ]);
    const attachmentIds = new Map<string, string[]>();
    for (const row of messageAttachmentsResult.rows) attachmentIds.set(row.message_id, [...(attachmentIds.get(row.message_id) || []), row.attachment_id]);
    const nodes: DiscussionNode[] = nodesResult.rows.map(row => ({ id: String(row.id), title: String(row.title), summary: String(row.summary), status: row.status as DiscussionNode['status'], kind: row.kind as DiscussionNode['kind'], sourceNodeId: row.source_node_id ? String(row.source_node_id) : undefined, sourceMessageId: row.source_message_id ? String(row.source_message_id) : undefined, anchorText: row.anchor_text ? String(row.anchor_text) : undefined, x: Number(row.position_x), y: Number(row.position_y), createdAt: asIso(row.created_at), updatedAt: asIso(row.updated_at) }));
    const messages: StoredMessage[] = messagesResult.rows.map(row => ({ id: String(row.id), nodeId: String(row.node_id), segmentId: row.segment_id ? String(row.segment_id) : undefined, kind: row.kind as StoredMessage['kind'], text: String(row.body), manifestId: row.manifest_id ? String(row.manifest_id) : undefined, createdAt: asIso(row.created_at), operation: row.operation as StoredMessage['operation'], sourceMessageId: row.source_message_id ? String(row.source_message_id) : undefined, versionGroupId: row.version_group_id ? String(row.version_group_id) : undefined, version: Number(row.version), replyToMessageId: row.reply_to_message_id ? String(row.reply_to_message_id) : undefined, usage: row.usage ? asJson(row.usage) : undefined, reasoning: row.reasoning ? String(row.reasoning) : undefined, toolCalls: row.tool_calls ? asJson(row.tool_calls) : undefined, attachmentIds: attachmentIds.get(String(row.id)) || [] }));
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
        return { id: String(row.id), name: String(row.name), mimeType: String(row.mime_type), size: Number(row.size_bytes), kind: row.kind as StoredAttachment['kind'], extractedText: row.extracted_text ? String(row.extracted_text) : undefined, summary: row.summary ? String(row.summary) : undefined, chunkCount: row.chunk_count === null ? undefined : Number(row.chunk_count), resourceId: row.resource_id ? String(row.resource_id) : undefined, resourceVersionId: row.resource_version_id ? String(row.resource_version_id) : undefined, digest: version ? String(version.digest) : undefined, blobRef: version ? String(version.blob_ref) : undefined, createdAt: asIso(row.created_at) };
      }),
      resources: resourcesResult.rows.map(row => ({ id: String(row.resource_id), workspaceId: String(row.workspace_id), kind: row.kind as Resource['kind'], logicalName: String(row.logical_name), createdAt: asIso(row.created_at) })),
      resourceVersions: resourceVersionsResult.rows.map(row => ({ id: String(row.resource_version_id), resourceId: String(row.resource_id), version: Number(row.version), digestAlgorithm: row.digest_algorithm as ResourceVersion['digestAlgorithm'], digest: String(row.digest), canonicalization: row.canonicalization as ResourceVersion['canonicalization'], mediaType: String(row.media_type), size: Number(row.size_bytes), blobRef: String(row.blob_ref), createdAt: asIso(row.created_at) })),
      materializations: materializationsResult.rows.map(row => ({ id: String(row.materialization_id), resourceVersionId: String(row.resource_version_id), kind: row.kind as ResourceMaterialization['kind'], generator: row.generator as ResourceMaterialization['generator'], createdAt: asIso(row.created_at) })),
      fileChunks: state.fileChunks || [],
      auditEvents: auditResult.rows.map(row => ({ id: String(row.id), projectId: String(row.project_id), nodeId: row.node_id ? String(row.node_id) : undefined, action: String(row.action), entityType: row.entity_type as AuditEvent['entityType'], entityId: String(row.entity_id), metadata: asJson(row.metadata), createdAt: asIso(row.created_at) })),
      updatedAt: asIso(project.updated_at),
    };
  }

  private async persist(database: SqlQueryable, workspace: WorkspaceData, previous?: WorkspaceData, options?: WorkspaceUpdateOptions): Promise<void> {
    if (options?.purge) {
      const nodeId = options.purge.nodeId;
      const retained = await database.query(`SELECT run_id FROM execution_runs WHERE workspace_id=$1 AND (
        node_id=$2 OR node_id='temp:' || $2 OR input_envelope->'request'->'history' @> $3::jsonb
        OR input_envelope->'request'->'contextItems' @> $4::jsonb OR input_envelope->'request'->'contextItems' @> $5::jsonb) LIMIT 1`,
        [workspace.projectId, nodeId, JSON.stringify([{ nodeId }]), JSON.stringify([{ sourceNodeId: nodeId }]), JSON.stringify([{ sourceType: 'node', sourceId: nodeId }])]);
      if (retained.rows.length) throw Object.assign(new Error('该节点仍被不可变执行历史引用，请使用归档；物理删除需要统一的执行历史清理策略。'), { code: 'PURGE_HAS_EXECUTION_HISTORY', status: 409 });
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
    for (const node of nodes) await database.query(`INSERT INTO rhiza_nodes (id,project_id,title,summary,status,kind,position_x,position_y,created_at,updated_at,anchor_text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,summary=EXCLUDED.summary,status=EXCLUDED.status,kind=EXCLUDED.kind,position_x=EXCLUDED.position_x,position_y=EXCLUDED.position_y,updated_at=EXCLUDED.updated_at,anchor_text=EXCLUDED.anchor_text`, [node.id,workspace.projectId,node.title,node.summary,node.status,node.kind,node.x,node.y,node.createdAt,node.updatedAt,node.anchorText || null]);
    for (const segment of segments) await database.query(`INSERT INTO rhiza_segments (id,node_id,ordinal,title,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET node_id=EXCLUDED.node_id,ordinal=EXCLUDED.ordinal,title=EXCLUDED.title`, [segment.id,segment.nodeId,segment.ordinal,segment.title,segment.createdAt]);
    for (const manifest of manifests) await database.query(`INSERT INTO rhiza_context_manifests (id,project_id,node_id,request_id,mode,provider,model,runtime,estimated_tokens,manifest,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) ON CONFLICT (id) DO NOTHING`, [manifest.id,workspace.projectId,manifest.nodeId,manifest.requestId,manifest.mode,manifest.provider,manifest.model,manifest.runtime,manifest.estimatedTokens,JSON.stringify(manifest),manifest.createdAt]);
    for (const resource of resources) await database.query(`INSERT INTO rhiza_resources (resource_id,workspace_id,kind,logical_name,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (resource_id) DO NOTHING`, [resource.id,resource.workspaceId,resource.kind,resource.logicalName,resource.createdAt]);
    for (const version of resourceVersions) await database.query(`INSERT INTO rhiza_resource_versions (resource_version_id,resource_id,version,digest_algorithm,digest,canonicalization,media_type,size_bytes,blob_ref,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [version.id,version.resourceId,version.version,version.digestAlgorithm,version.digest,version.canonicalization,version.mediaType,version.size,version.blobRef,version.createdAt]);
    for (const materialization of materializations) await database.query(`INSERT INTO rhiza_resource_materializations (materialization_id,resource_version_id,kind,generator,created_at) VALUES ($1,$2,$3,$4,$5)`, [materialization.id,materialization.resourceVersionId,materialization.kind,materialization.generator,materialization.createdAt]);
    for (const attachment of attachments) await database.query(`INSERT INTO rhiza_attachments (id,project_id,name,mime_type,size_bytes,kind,storage_key,extracted_text,created_at,resource_id,resource_version_id,summary,chunk_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,mime_type=EXCLUDED.mime_type,size_bytes=EXCLUDED.size_bytes,kind=EXCLUDED.kind,extracted_text=EXCLUDED.extracted_text,resource_id=EXCLUDED.resource_id,resource_version_id=EXCLUDED.resource_version_id,summary=EXCLUDED.summary,chunk_count=EXCLUDED.chunk_count`, [attachment.id,workspace.projectId,attachment.name,attachment.mimeType,attachment.size,attachment.kind,attachment.blobRef || attachment.id,attachment.extractedText || null,attachment.createdAt,attachment.resourceId || null,attachment.resourceVersionId || null,attachment.summary || null,attachment.chunkCount ?? null]);
    for (const message of messages) await database.query(`INSERT INTO rhiza_messages (id,node_id,segment_id,kind,body,manifest_id,created_at,operation,version_group_id,version,usage,reasoning,tool_calls) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb) ON CONFLICT (id) DO UPDATE SET segment_id=EXCLUDED.segment_id,body=EXCLUDED.body,manifest_id=EXCLUDED.manifest_id,operation=EXCLUDED.operation,version_group_id=EXCLUDED.version_group_id,version=EXCLUDED.version,usage=EXCLUDED.usage,reasoning=EXCLUDED.reasoning,tool_calls=EXCLUDED.tool_calls`, [message.id,message.nodeId,message.segmentId || null,message.kind,message.text,message.manifestId || null,message.createdAt,message.operation || 'send',message.versionGroupId || null,message.version || 1,JSON.stringify(message.usage || null),message.reasoning || null,JSON.stringify(message.toolCalls || null)]);
    for (const node of nodes) await database.query('UPDATE rhiza_nodes SET source_node_id=$2, source_message_id=$3 WHERE id=$1', [node.id,node.sourceNodeId || null,node.sourceMessageId || null]);
    for (const message of messages) await database.query('UPDATE rhiza_messages SET source_message_id=$2, reply_to_message_id=$3 WHERE id=$1', [message.id,message.sourceMessageId || null,message.replyToMessageId || null]);
    for (const anchor of anchors) await database.query(`INSERT INTO rhiza_anchors (id,project_id,node_id,message_id,segment_id,selected_text,start_offset,end_offset,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE SET node_id=EXCLUDED.node_id,message_id=EXCLUDED.message_id,segment_id=EXCLUDED.segment_id,selected_text=EXCLUDED.selected_text,start_offset=EXCLUDED.start_offset,end_offset=EXCLUDED.end_offset`, [anchor.id,workspace.projectId,anchor.nodeId,anchor.messageId || null,anchor.segmentId || null,anchor.selectedText || null,anchor.startOffset ?? null,anchor.endOffset ?? null,anchor.createdAt]);
    for (const edge of edges) await database.query(`INSERT INTO rhiza_edges (id,project_id,source_node_id,target_node_id,anchor_id,relation,label,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET source_node_id=EXCLUDED.source_node_id,target_node_id=EXCLUDED.target_node_id,anchor_id=EXCLUDED.anchor_id,relation=EXCLUDED.relation,label=EXCLUDED.label`, [edge.id,workspace.projectId,edge.source,edge.target,edge.anchorId || null,relationToDb(edge.relation),edge.label,edge.createdAt]);
    if (messages.length) await database.query('DELETE FROM rhiza_message_attachments WHERE message_id = ANY($1::uuid[])', [messages.map(message => message.id)]);
    for (const message of messages) for (const [ordinal, attachmentId] of (message.attachmentIds || []).entries()) await database.query('INSERT INTO rhiza_message_attachments (message_id,attachment_id,ordinal) VALUES ($1,$2,$3)', [message.id,attachmentId,ordinal]);
    for (const audit of audits) await database.query(`INSERT INTO rhiza_audit_events (id,project_id,node_id,action,entity_type,entity_id,metadata,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT (id) DO NOTHING`, [audit.id,audit.projectId,audit.nodeId || null,audit.action,audit.entityType,audit.entityId,JSON.stringify(audit.metadata),audit.createdAt]);
    await database.query('UPDATE rhiza_projects SET active_node_id=$2 WHERE id=$1', [workspace.projectId, workspace.activeNodeId]);
    await this.deleteMissing(database, workspace, options);
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
