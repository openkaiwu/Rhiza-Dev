import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { Anchor, AuditEvent, ContextManifest, DiscussionEdge, DiscussionNode, FileChunk, Segment, StoredAttachment, StoredMessage, WorkspaceData } from './domain';
import { createSeedWorkspace } from './seed';
import { validateWorkspaceHistoryUpdate, type WorkspaceRepository, type WorkspaceUpdateOptions } from './store';
import type { WorkspaceDirectoryPort } from './identity/workspace-directory';

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
const changedItems = <T extends { id: string }>(items: T[], previous?: T[]): T[] => {
  if (!previous) return items;
  const before = new Map(previous.map(item => [item.id, JSON.stringify(item)]));
  return items.filter(item => before.get(item.id) !== JSON.stringify(item));
};

function relationalSeed(projectId: string): WorkspaceData {
  const seed = createSeedWorkspace();
  const nodeIds = new Map(seed.discussionNodes.map(node => [node.id, randomUUID()]));
  const messageIds = new Map(seed.messages.map(message => [message.id, randomUUID()]));
  const segmentIds = new Map(seed.segments.map(segment => [segment.id, randomUUID()]));
  const activeNodeId = nodeIds.get(seed.activeNodeId)!;
  return {
    ...seed,
    projectId,
    nodeId: activeNodeId,
    activeNodeId,
    discussionNodes: seed.discussionNodes.map(node => ({ ...node, id: nodeIds.get(node.id)!, sourceNodeId: node.sourceNodeId ? nodeIds.get(node.sourceNodeId) : undefined, sourceMessageId: node.sourceMessageId ? messageIds.get(node.sourceMessageId) : undefined })),
    messages: seed.messages.map(message => ({ ...message, id: messageIds.get(message.id)!, nodeId: nodeIds.get(message.nodeId)!, segmentId: message.segmentId ? segmentIds.get(message.segmentId) : undefined, sourceMessageId: message.sourceMessageId ? messageIds.get(message.sourceMessageId) : undefined, replyToMessageId: message.replyToMessageId ? messageIds.get(message.replyToMessageId) : undefined })),
    segments: seed.segments.map(segment => ({ ...segment, id: segmentIds.get(segment.id)!, nodeId: nodeIds.get(segment.nodeId)! })),
  };
}

export class PostgresWorkspaceStore implements WorkspaceRepository {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly database: TransactionalSql, private readonly projectId = DEFAULT_PROJECT_ID) {}

  forWorkspace(workspaceId: string): WorkspaceRepository {
    return workspaceId === this.projectId ? this : new PostgresWorkspaceStore(this.database, workspaceId);
  }

  readonly workspaceDirectory: WorkspaceDirectoryPort = {
    listWorkspaces: async (userId, includeArchived = false) => {
      const result = await this.database.query<{ workspace_id: string; name: string; status: 'active' | 'archived'; created_by: string; revision: number }>(`SELECT workspace_id,name,status,created_by,COALESCE((settings->>'revision')::integer,1) revision FROM workspaces WHERE created_by=$1${includeArchived ? '' : " AND status='active'"} ORDER BY updated_at DESC`, [userId]);
      return result.rows.map(row => ({ workspaceId: row.workspace_id, name: row.name, status: row.status, createdBy: row.created_by, revision: row.revision }));
    },
    createWorkspace: async record => {
      await this.database.query('INSERT INTO rhiza_projects (id,title,state) VALUES ($1,$2,$3::jsonb) ON CONFLICT (id) DO NOTHING', [record.workspaceId, record.name, '{}']);
      await this.database.query("INSERT INTO workspaces (workspace_id,name,status,created_by,settings) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (workspace_id) DO NOTHING", [record.workspaceId, record.name, record.status, record.createdBy, JSON.stringify({ revision: record.revision })]);
      await this.database.query("INSERT INTO workspace_members (workspace_id,user_id,role) VALUES ($1,$2,'owner') ON CONFLICT (workspace_id,user_id) DO NOTHING", [record.workspaceId, record.createdBy]);
    },
    updateWorkspace: async record => { await this.database.query('UPDATE workspaces SET name=$2,status=$3,settings=jsonb_set(settings,\'{revision}\',to_jsonb($4::int),true),updated_at=now() WHERE workspace_id=$1', [record.workspaceId, record.name, record.status, record.revision]); },
  };

  static fromConnectionString(connectionString: string, projectId?: string) {
    return new PostgresWorkspaceStore(new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 }), projectId);
  }

  async close(): Promise<void> {
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
      const seed = relationalSeed(this.projectId);
      await this.persist(database, seed);
      return seed;
    });
  }

  async update(mutator: (current: WorkspaceData) => WorkspaceData | Promise<WorkspaceData>, options?: WorkspaceUpdateOptions): Promise<WorkspaceData> {
    let result!: WorkspaceData;
    this.queue = this.queue.catch(() => undefined).then(async () => {
      result = await this.inTransaction(async database => {
        let current = await this.readFrom(database, true);
        if (!current) {
          current = relationalSeed(this.projectId);
          await this.persist(database, current);
          await database.query('SELECT id FROM rhiza_projects WHERE id = $1 FOR UPDATE', [this.projectId]);
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

  private async readFrom(database: SqlQueryable, lock = false): Promise<WorkspaceData | undefined> {
    const projects = await database.query<{ id: string; title: string; active_node_id: string | null; state: unknown; updated_at: unknown }>(`SELECT id, title, active_node_id, state, updated_at FROM rhiza_projects WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [this.projectId]);
    const project = projects.rows[0];
    if (!project) return undefined;
    const [nodesResult, segmentsResult, messagesResult, anchorsResult, edgesResult, manifestsResult, attachmentsResult, messageAttachmentsResult, auditResult] = await Promise.all([
      database.query<Record<string, unknown>>('SELECT * FROM rhiza_nodes WHERE project_id = $1 ORDER BY created_at, id', [project.id]),
      database.query<Record<string, unknown>>('SELECT s.* FROM rhiza_segments s JOIN rhiza_nodes n ON n.id = s.node_id WHERE n.project_id = $1 ORDER BY s.node_id, s.ordinal', [project.id]),
      database.query<Record<string, unknown>>('SELECT m.* FROM rhiza_messages m JOIN rhiza_nodes n ON n.id = m.node_id WHERE n.project_id = $1 ORDER BY m.event_ordinal, m.id', [project.id]),
      database.query<Record<string, unknown>>('SELECT * FROM rhiza_anchors WHERE project_id = $1 ORDER BY created_at, id', [project.id]),
      database.query<Record<string, unknown>>('SELECT * FROM rhiza_edges WHERE project_id = $1 ORDER BY created_at, id', [project.id]),
      database.query<Record<string, unknown>>('SELECT * FROM rhiza_context_manifests WHERE project_id = $1 ORDER BY created_at, id', [project.id]),
      database.query<Record<string, unknown>>('SELECT * FROM rhiza_attachments WHERE project_id = $1 ORDER BY created_at, id', [project.id]),
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
      attachments: attachmentsResult.rows.map(row => ({ id: String(row.id), name: String(row.name), mimeType: String(row.mime_type), size: Number(row.size_bytes), kind: row.kind as StoredAttachment['kind'], extractedText: row.extracted_text ? String(row.extracted_text) : undefined, createdAt: asIso(row.created_at) })),
      fileChunks: state.fileChunks || [],
      auditEvents: auditResult.rows.map(row => ({ id: String(row.id), projectId: String(row.project_id), nodeId: row.node_id ? String(row.node_id) : undefined, action: String(row.action), entityType: row.entity_type as AuditEvent['entityType'], entityId: String(row.entity_id), metadata: asJson(row.metadata), createdAt: asIso(row.created_at) })),
      updatedAt: asIso(project.updated_at),
    };
  }

  private async persist(database: SqlQueryable, workspace: WorkspaceData, previous?: WorkspaceData, options?: WorkspaceUpdateOptions): Promise<void> {
    const nodes = changedItems(workspace.discussionNodes, previous?.discussionNodes);
    const segments = changedItems(workspace.segments, previous?.segments);
    const manifests = changedItems(workspace.manifests, previous?.manifests);
    const attachments = changedItems(workspace.attachments, previous?.attachments);
    const messages = changedItems(workspace.messages, previous?.messages);
    const anchors = changedItems(workspace.anchors, previous?.anchors);
    const edges = changedItems(workspace.discussionEdges, previous?.discussionEdges);
    const audits = changedItems(workspace.auditEvents, previous?.auditEvents);
    await database.query(`INSERT INTO rhiza_projects (id, title, state, created_at, updated_at) VALUES ($1,$2,$3::jsonb,$4,$4) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, state=EXCLUDED.state, updated_at=EXCLUDED.updated_at`, [workspace.projectId, workspace.projectTitle, JSON.stringify({ mode: workspace.mode, contextItems: workspace.contextItems, fileChunks: workspace.fileChunks }), workspace.updatedAt]);
    for (const node of nodes) await database.query(`INSERT INTO rhiza_nodes (id,project_id,title,summary,status,kind,position_x,position_y,created_at,updated_at,anchor_text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,summary=EXCLUDED.summary,status=EXCLUDED.status,kind=EXCLUDED.kind,position_x=EXCLUDED.position_x,position_y=EXCLUDED.position_y,updated_at=EXCLUDED.updated_at,anchor_text=EXCLUDED.anchor_text`, [node.id,workspace.projectId,node.title,node.summary,node.status,node.kind,node.x,node.y,node.createdAt,node.updatedAt,node.anchorText || null]);
    for (const segment of segments) await database.query(`INSERT INTO rhiza_segments (id,node_id,ordinal,title,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET node_id=EXCLUDED.node_id,ordinal=EXCLUDED.ordinal,title=EXCLUDED.title`, [segment.id,segment.nodeId,segment.ordinal,segment.title,segment.createdAt]);
    for (const manifest of manifests) await database.query(`INSERT INTO rhiza_context_manifests (id,project_id,node_id,request_id,mode,provider,model,runtime,estimated_tokens,manifest,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) ON CONFLICT (id) DO NOTHING`, [manifest.id,workspace.projectId,manifest.nodeId,manifest.requestId,manifest.mode,manifest.provider,manifest.model,manifest.runtime,manifest.estimatedTokens,JSON.stringify(manifest),manifest.createdAt]);
    for (const attachment of attachments) await database.query(`INSERT INTO rhiza_attachments (id,project_id,name,mime_type,size_bytes,kind,storage_key,extracted_text,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,mime_type=EXCLUDED.mime_type,size_bytes=EXCLUDED.size_bytes,kind=EXCLUDED.kind,extracted_text=EXCLUDED.extracted_text`, [attachment.id,workspace.projectId,attachment.name,attachment.mimeType,attachment.size,attachment.kind,attachment.id,attachment.extractedText || null,attachment.createdAt]);
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
