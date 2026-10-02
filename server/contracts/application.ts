import type { AuditEvent, ChatOperation, ContextMode, ContextStatus, GenerationOptions, StoredAttachment, StoredMessage, WorkspaceData } from '../domain';
import type { WorkspaceActivityItem } from '../domain-journal';
import type { ActorRef, RequestIdentity, ScopeRef } from './references';
import type { GraphChangesInput, GraphChangesResult, GraphNeighborhoodInput, GraphPathInput, GraphQueryResult, GraphTreeInput } from './graph-projection';
import type { ProviderCatalogQuery, ProviderDiscoveryBatchInput, ProviderDiscoveryBatchResult } from '../provider-domain';

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
  onRuntimeEvent?: (event: { type: string }) => void | Promise<void>;
}

export type CommandResult<K extends CommandType> = CommandMap[K]['result'];
export type QueryResult<K extends QueryType> = QueryMap[K]['result'];

/** The only public Application surface. HTTP and other hosts use these two calls. */
export interface Application {
  execute<K extends CommandType>(envelope: CommandEnvelope<K>, options?: CommandExecutionOptions): Promise<CommandResult<K>>;
  query<K extends QueryType>(envelope: QueryEnvelope<K>): Promise<QueryResult<K>>;
}

export interface ExecutionRunView {
  input: { executor: { runtime: string; modelSpecRef: string; providerEndpointRef: string; model: string; provider: string }; request: { prompt: string; manifestId: string; attachments?: StoredAttachment[]; generation?: GenerationOptions; operation?: ChatOperation; sourceMessageId?: string } };
  id: string; commandId: string; workspaceId: string; nodeId: string; status: string; attempt: number;
  parentRunRef?: string; inputHash: string; createdAt: string; terminalAt?: string;
  error?: { code: string; class: string; message: string };
  telemetry: { durationMs?: number; ttftMs?: number; usage?: import('../domain').TokenUsage; traceCount: number };
}

export interface CreateConversationRunResult {
  userMessage: WorkspaceData['messages'][number];
  assistantMessage: WorkspaceData['messages'][number];
  manifest: WorkspaceData['manifests'][number];
}

export type LegacyAttachmentView = Omit<StoredAttachment, 'extractedText'>;

type Empty = Record<string, never>;
export interface WorkspaceRecord { workspaceId: string; name: string; status: 'active' | 'archived'; createdBy: string; revision: number }

/** Versioned operation registry. Additive changes receive a new command key. */
export interface CommandMap {
  CreateCollaboration: { payload: { prompt: string; mode: import('./collaboration').CollaborationMode; modelIds: string[]; synthesisModelId: string; attachmentIds?: string[]; tokenLimit?: number; timeLimitMs?: number; maxRounds?: number }; result: { collaboration: import('./collaboration').CollaborationRecord } };
  InvokeCollaboration: { payload: { collaborationId: string; participantId: string; round: number }; result: { collaboration: import('./collaboration').CollaborationRecord; result: CreateConversationRunResult } };
  RetryCollaborationParticipant: { payload: { collaborationId: string; attemptId: string }; result: CommandMap['InvokeCollaboration']['result'] };
  StopCollaboration: { payload: { collaborationId: string }; result: { collaboration: import('./collaboration').CollaborationRecord } };
  RunCollaboration: { payload: { collaborationId: string }; result: CommandMap['StopCollaboration']['result'] };
  SynthesizeCollaboration: { payload: { collaborationId: string }; result: CommandMap['InvokeCollaboration']['result'] };
  RetainCollaboration: { payload: { collaborationId: string; targetNodeId: string }; result: { message: StoredMessage } };
  PreviewWorkspaceBundle: { payload: { bytes: AsyncIterable<Uint8Array>; executionMappings?: import('./bundle-preflight').BundleExecutionMappingChoice[] }; result: { workspaceId: string; name: string; archiveDigest: string; messages: number; runs: number; resourceVersions: number;
    documentVersion: import('../domain/portable-bundle').BundleContentAssessment['documentVersion']; canImport: boolean; reasons: string[];
    missingResourceCount: number; missingResources: import('../domain/portable-bundle').ExternalResourceDescriptor[]; missingResourcesTruncated: boolean;
    executionRequirementCount: number; executionRequirements: import('../domain/portable-bundle').BundleExecutionRequirement[]; executionRequirementsTruncated: boolean;
    executionConfiguration: import('./bundle-preflight').BundleExecutionConfiguration } };
  ImportWorkspaceBundle: { payload: { bytes: AsyncIterable<Uint8Array>; executionMappings?: import('./bundle-preflight').BundleExecutionMappingChoice[] }; result: { workspaceId: string; importId: string; executionConfiguration: import('./bundle-preflight').BundleExecutionConfiguration } };
  HydrateWorkspaceBundle: { payload: { bytes: AsyncIterable<Uint8Array> } & ({ resources: AsyncIterable<import('../domain/portable-bundle').ProvidedBundleResource> } | { multipartContentType: string }); result: import('../domain/portable-bundle').BundleExport };
  CreateManagedBackup: { payload: { retryOf?: string }; result: import('./managed-backup').ManagedBackup };
  ReplayExecutionRun: { payload: { runId: string; policy: 'exact' | 'partial' | 'current-model' }; result: CreateConversationRunResult & { replay: { classification: 'exact' | 'partial' | 'current-model'; sourceRunRef: string; sourceManifestRef: string } } };
  CreateWorkspace: { payload: { name: string; workspaceId?: string }; result: WorkspaceRecord };
  RenameWorkspace: { payload: { name: string }; result: WorkspaceRecord };
  ArchiveWorkspace: { payload: Empty; result: WorkspaceRecord };
  RestoreWorkspace: { payload: Empty; result: WorkspaceRecord };
  SwitchWorkspace: { payload: Empty; result: WorkspaceRecord };
  SaveProvider: { payload: { providerId?: string; body: unknown }; result: unknown };
  DiscoverProviderModels: { payload: { providerId: string }; result: unknown };
  DiscoverProviderBatch: { payload: ProviderDiscoveryBatchInput; result: ProviderDiscoveryBatchResult };
  UpdateModelPreference: { payload: { modelId: string; favorite?: boolean; pinned?: boolean }; result: unknown };
  SelectModel: { payload: { modelId: string }; result: unknown };
  RegisterLegacyAttachment: { payload: { name: string; mimeType: string; bytes: Uint8Array }; result: { attachment: LegacyAttachmentView } };
  SetConversationModel: { payload: { nodeId: string; modelId: string | null }; result: WorkspaceData };
  SetWorkspaceModel: { payload: { modelId: string | null }; result: WorkspaceData };
  RenameConversation: { payload: { nodeId: string; title: string }; result: WorkspaceData };
  UpdateSegment: { payload: { segmentId: string; title?: string; status?: 'active' | 'archived' }; result: WorkspaceData };
  RetryExecutionRun: { payload: { runId: string }; result: CreateConversationRunResult };
  CancelExecutionRun: { payload: { runId: string }; result: ExecutionRunView };
  CreateConversationRun: {
    payload: { parentRunRef?: string; prompt: string; operation: ChatOperation; sourceMessageId?: string; attachmentIds: string[]; generation: GenerationOptions };
    result: CreateConversationRunResult;
  };
  ChangeContextMode: { payload: { mode: ContextMode }; result: WorkspaceData };
  ChangeContextSelection: { payload: { contextItemId: string; status?: ContextStatus; pinned?: boolean }; result: WorkspaceData };
  DecideContextRecommendation: { payload: { sourceType: NonNullable<import('../domain').ContextItem['sourceType']>; sourceId: string; sourceRevision: string; decision: 'accept' | 'reject'; reason: string }; result: WorkspaceData };
  AddContextSource: { payload: { sourceType: 'node' | 'segment' | 'file'; sourceId: string; status?: ContextStatus }; result: WorkspaceData };
  CreateBranch: { payload: { title: string; sourceMessageId?: string; anchorText?: string; anchorStart?: number; anchorEnd?: number; messages?: Array<{ kind: 'user' | 'assistant'; text: string; createdAt?: string }> }; result: WorkspaceData };
  CreateGraphNode: { payload: { title: string; summary?: string; sourceMessageId?: string; x?: number; y?: number }; result: WorkspaceData };
  ExecuteTemporaryConversation: { payload: { prompt: string; sourceNodeId: string; anchorText: string; history?: Array<{ kind: 'user' | 'assistant'; text: string; createdAt?: string }> }; result: { userMessage: StoredMessage; assistantMessage: StoredMessage; model: string } };
  ActivateNode: { payload: { nodeId: string }; result: WorkspaceData };
  ChangeNodeStatus: { payload: { nodeId: string; status: 'draft' | 'active' | 'resolved' | 'stale' | 'archived'; expectedNodeVersion?: import('./graph-batch').GraphNodeVersion }; result: WorkspaceData };
  CreateSegment: { payload: { nodeId: string; title: string; messageIds: string[]; range?: { messageId: string; startOffset: number; endOffset: number; selectedText: string } }; result: { workspace: WorkspaceData; segment: WorkspaceData['segments'][number] } };
  ArchiveObject: { payload: { nodeId: string; expectedNodeVersion?: import('./graph-batch').GraphNodeVersion }; result: WorkspaceData };
  PurgeObject: { payload: { nodeId: string; confirmation: string; reason: string }; result: { workspace: WorkspaceData; purgeReceipt: AuditEvent } };
  CreateRelation: { payload: { source: string; target: string; relation: 'derived-from' | 'references' | 'related-to' | 'merged-into'; label?: string; expectedNodeVersions?: Array<import('./graph-batch').GraphNodeVersion & { nodeId: string }> }; result: WorkspaceData };
  RemoveRelation: { payload: { edgeId: string; expectedRelation?: WorkspaceData['discussionEdges'][number] }; result: WorkspaceData };
  BatchGraphOperations: { payload: { items: import('./graph-batch').GraphBatchItem[] }; result: import('./graph-batch').GraphBatchResult };
  UndoGraphBatch: { payload: { batchId: string; itemIds?: string[] }; result: import('./graph-batch').GraphBatchResult };
  UpdateGraphLayout: { payload: { positions: Array<{ nodeId: string; x: number; y: number }> }; result: WorkspaceData };
  SavePersonalGraphView: { payload: import('./personal-graph-view').SavePersonalGraphView; result: import('./personal-graph-view').PersonalGraphViewReceipt };
  CreateMergeRevision: { payload: { sourceNodeId: string; targetNodeId?: string; summary?: string }; result: WorkspaceData };
  RegisterResource: { payload: { name: string; mimeType: string; bytes: Uint8Array }; result: { attachment: LegacyAttachmentView } };
  CreateResourceVersion: { payload: { attachmentId: string; bytes: Uint8Array }; result: { attachment: LegacyAttachmentView } };
  UpdateProviderProfile: { payload: { name: string; model: string; baseUrl: string; apiKey?: string }; result: unknown };
  RebuildGraphProjection: { payload: Empty; result: { version: string; checkpoint: number; checksum: string } };
}

export interface QueryMap {
  GetGraphBatch: { payload: { batchId: string }; result: import('./graph-batch').GraphBatchResult };
  GetPersonalGraphView: { payload: { viewType: string }; result: import('./personal-graph-view').PersonalGraphView };
  GetCollaboration: { payload: { collaborationId: string }; result: { collaboration: import('./collaboration').CollaborationRecord } };
  ListCollaborations: { payload: { limit?: number; nodeId?: string }; result: { collaborations: import('./collaboration').CollaborationRecord[] } };
  GetReplayPreflight: { payload: { runId: string }; result: { runId: string; sourceManifestId?: string; missingRefs: string[]; policies: Array<{ policy: 'exact' | 'partial' | 'current-model'; allowed: boolean; code?: string; differences: string[] }> } };
  GetContextPreview: { payload: { query: string; attachmentIds?: string[] }; result: { mode: ContextMode; items: import('../domain').ContextItem[]; recommendations: import('../domain').ContextItem[]; omissions: import('../domain').ContextOmission[]; budget: number; usedTokens: number; overBudget: boolean } };
  ExportWorkspaceBundle: { payload: import('../domain/portable-bundle').BundleExportOptions; result: import('../domain/portable-bundle').BundleExport };
  ListManagedBackups: { payload: Empty; result: import('./managed-backup').ManagedBackupList };
  DownloadManagedBackup: { payload: { backupId: string }; result: import('../domain/portable-bundle').BundleExport };
  GetProvenance: { payload: { outputId: string }; result: import('../domain').ProvenanceLink };
  GetContextHistory: { payload: { manifestId: string } | { messageId: string }; result: import('../domain').ContextHistory };
  ListExecutionRuns: { payload: { limit?: number }; result: ExecutionRunView[] };
  SearchWorkspace: { payload: { query: string; limit?: number }; result: Array<{ sourceType: 'node' | 'segment'; sourceId: string; nodeId: string; title: string; excerpt: string; titleMatch: boolean }> };
  GetRunByCommand: { payload: { commandId: string }; result: ExecutionRunView | null };
  GetExecutionRun: { payload: { runId: string }; result: ExecutionRunView };
  ListWorkspaces: { payload: { includeArchived?: boolean }; result: WorkspaceRecord[] };
  GetHealth: { payload: Empty; result: { ok: true } };
  GetWorkspace: { payload: Empty; result: WorkspaceData };
  GetWorkspaceActivity: { payload: { limit?: number }; result: WorkspaceActivityItem[] };
  GetProviders: { payload: ProviderCatalogQuery; result: unknown };
  GetProviderStatus: { payload: Empty; result: { configured: boolean; name: string; model: string; baseUrl: string } };
  ListModels: { payload: Empty; result: Array<{ id: string; provider: string; displayName: string; active: boolean }> };
  GetGraphNeighborhood: { payload: GraphNeighborhoodInput; result: GraphQueryResult };
  GetGraphPath: { payload: GraphPathInput; result: GraphQueryResult };
  GetGraphTree: { payload: GraphTreeInput; result: GraphQueryResult };
  GetGraphChanges: { payload: GraphChangesInput; result: GraphChangesResult };
}

/** Convenience factory for hosts that still use the M01 local workspace. */
export function withLegacyIdentity<T extends { commandId?: string; queryId?: string }>(request: T): T & { schemaVersion: '1.0.0'; workspaceId: string; actor: ActorRef; scope: ScopeRef } {
  return {
    ...request,
    schemaVersion: '1.0.0',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    actor: { actorType: 'human', actorId: '00000000-0000-4000-8000-000000000002' },
    scope: { scopeType: 'workspace', scopeId: '00000000-0000-4000-8000-000000000001' },
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
