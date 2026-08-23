import type { AuditEvent, ChatOperation, ContextMode, ContextStatus, GenerationOptions, StoredAttachment, StoredMessage, WorkspaceData } from '../domain';
import type { ActorRef, RequestIdentity, ScopeRef } from './references';

export type CommandType = keyof CommandMap;
export type QueryType = keyof QueryMap;

export interface CommandEnvelope<K extends CommandType = CommandType> extends RequestIdentity {
  commandId: string;
  commandType: K;
  expectedRevision?: number;
  payload: CommandMap[K]['payload'];
}

export interface QueryEnvelope<K extends QueryType = QueryType> extends RequestIdentity {
  queryId: string;
  queryType: K;
  payload: QueryMap[K]['payload'];
}

export interface CommandExecutionOptions {
  signal?: AbortSignal;
  onReady?: () => void | Promise<void>;
  onRuntimeEvent?: (event: { type: string; payload: unknown }) => void | Promise<void>;
}

export type CommandResult<K extends CommandType> = CommandMap[K]['result'];
export type QueryResult<K extends QueryType> = QueryMap[K]['result'];

/** The only public Application surface. HTTP and other hosts use these two calls. */
export interface Application {
  execute<K extends CommandType>(envelope: CommandEnvelope<K>, options?: CommandExecutionOptions): Promise<CommandResult<K>>;
  query<K extends QueryType>(envelope: QueryEnvelope<K>): Promise<QueryResult<K>>;
}

export interface CreateConversationRunResult {
  userMessage: WorkspaceData['messages'][number];
  assistantMessage: WorkspaceData['messages'][number];
  manifest: WorkspaceData['manifests'][number];
}

type Empty = Record<string, never>;

/** Versioned operation registry. Additive changes receive a new command key. */
export interface CommandMap {
  SaveProvider: { payload: { providerId?: string; body: unknown }; result: unknown };
  DiscoverProviderModels: { payload: { providerId: string }; result: unknown };
  UpdateModelPreference: { payload: { modelId: string; enabled?: boolean; displayName?: string }; result: unknown };
  SelectModel: { payload: { modelId: string }; result: unknown };
  RegisterLegacyAttachment: { payload: { name: string; mimeType: string; bytes: Uint8Array }; result: { attachment: StoredAttachment } };
  CreateConversationRun: {
    payload: { prompt: string; operation: ChatOperation; sourceMessageId?: string; attachmentIds: string[]; generation: GenerationOptions };
    result: CreateConversationRunResult;
  };
  ChangeContextMode: { payload: { mode: ContextMode }; result: WorkspaceData };
  ChangeContextSelection: { payload: { contextItemId: string; status?: ContextStatus; pinned?: boolean }; result: WorkspaceData };
  AddContextSource: { payload: { sourceType: 'node' | 'segment' | 'file'; sourceId: string; status?: ContextStatus }; result: WorkspaceData };
  CreateBranch: { payload: { title: string; sourceMessageId?: string; anchorText?: string; anchorStart?: number; anchorEnd?: number; messages?: Array<{ kind: 'user' | 'assistant'; text: string; createdAt?: string }> }; result: WorkspaceData };
  CreateGraphNode: { payload: { title: string; summary?: string; sourceMessageId?: string; x?: number; y?: number }; result: WorkspaceData };
  ExecuteTemporaryConversation: { payload: { prompt: string; sourceNodeId: string; anchorText: string; history?: Array<{ kind: 'user' | 'assistant'; text: string; createdAt?: string }> }; result: { userMessage: StoredMessage; assistantMessage: StoredMessage; model: string } };
  ActivateNode: { payload: { nodeId: string }; result: WorkspaceData };
  ChangeNodeStatus: { payload: { nodeId: string; status: 'draft' | 'active' | 'resolved' | 'stale' | 'archived' }; result: WorkspaceData };
  CreateSegment: { payload: { nodeId: string; title: string; messageIds: string[] }; result: { workspace: WorkspaceData; segment: WorkspaceData['segments'][number] } };
  ArchiveObject: { payload: { nodeId: string }; result: WorkspaceData };
  PurgeObject: { payload: { nodeId: string; confirmation: string; reason: string }; result: { workspace: WorkspaceData; purgeReceipt: AuditEvent } };
  CreateRelation: { payload: { source: string; target: string; relation: 'derived-from' | 'references' | 'related-to' | 'merged-into'; label?: string }; result: WorkspaceData };
  RemoveRelation: { payload: { edgeId: string }; result: WorkspaceData };
  UpdateGraphLayout: { payload: { positions: Array<{ nodeId: string; x: number; y: number }> } | { nodeId: string; x: number; y: number }; result: WorkspaceData };
  CreateMergeRevision: { payload: { sourceNodeId: string; targetNodeId: string; summary?: string }; result: WorkspaceData };
  RegisterResource: { payload: { name: string; mimeType: string; bytes: Uint8Array }; result: WorkspaceData };
  CreateResourceVersion: { payload: { attachmentId: string; bytes: Uint8Array }; result: WorkspaceData };
  UpdateProviderProfile: { payload: { name: string; model: string; baseUrl: string; apiKey?: string }; result: unknown };
}

export interface QueryMap {
  GetHealth: { payload: Empty; result: { ok: true } };
  GetWorkspace: { payload: Empty; result: WorkspaceData };
  GetProviders: { payload: Empty; result: unknown };
  GetProviderStatus: { payload: Empty; result: { configured: boolean; name: string; model: string; baseUrl: string } };
  ListModels: { payload: Empty; result: Array<{ id: string; provider: string; displayName: string; active: boolean }> };
}

/** Convenience factory for hosts that still use the M01 local workspace. */
export function withLegacyIdentity<T extends { commandId?: string; queryId?: string }>(request: T): T & { schemaVersion: '1.0.0'; workspaceId: string; actor: ActorRef; scope: ScopeRef } {
  return {
    ...request,
    schemaVersion: '1.0.0',
    workspaceId: 'legacy-default-workspace',
    actor: { actorType: 'human', actorId: 'legacy-local' },
    scope: { scopeType: 'workspace', scopeId: 'legacy-default-workspace' },
  };
}

export function createLegacyCommandEnvelope<K extends CommandType>(
  commandId: string,
  commandType: K,
  payload: CommandMap[K]['payload'],
  correlationId?: string,
): CommandEnvelope<K> {
  return withLegacyIdentity({ commandId, commandType, payload, correlationId });
}

export function createLegacyQueryEnvelope<K extends QueryType>(
  queryId: string,
  queryType: K,
  payload: QueryMap[K]['payload'],
  correlationId?: string,
): QueryEnvelope<K> {
  return withLegacyIdentity({ queryId, queryType, payload, correlationId });
}
