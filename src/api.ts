import type { Attachment, CollaborationInput, CollaborationRecord, ChatOperation, ContextHistory, ContextManifest, ContextMode, ContextStatus, GenerationOptions, Message, ProviderCatalog, ProviderPreset, ProviderPresetInfo, ProviderStatus, TokenUsage, ToolCall, WorkspaceActivityItem, WorkspaceSnapshot, WorkspaceRecord } from './types';

export type ApiErrorCategory = 'validation' | 'conflict' | 'permission' | 'not_found' | 'infrastructure';

export interface ApiErrorDetails {
  recovery?: string;
  category?: ApiErrorCategory;
  retryable?: boolean;
  correlationId?: string;
}

export class ApiError extends Error {
  constructor(message: string, readonly code = 'API_ERROR', readonly status = 500, readonly details: ApiErrorDetails = {}) {
    super(message);
  }

  get category() { return this.details.category; }
  get retryable() { return this.details.retryable; }
  get correlationId() { return this.details.correlationId; }
}

type ErrorPayload = { code?: string; message?: string; category?: ApiErrorCategory; retryable?: boolean; correlationId?: string; recovery?: string };
let currentWorkspaceId: string | undefined;
const scopedPath = (path: string) => currentWorkspaceId && /^\/api\/(?!v1\/workspaces(?:\/|\?|$)|bundle\/(?:import|preview|hydrate)$|health$|providers|models)/.test(path) ? `/api/v1/workspaces/${encodeURIComponent(currentWorkspaceId)}${path.slice(4)}` : path;

function apiError(payload: ErrorPayload | undefined, status: number) {
  return new ApiError(payload?.message || `请求失败（${status}）`, payload?.code, status, {
    category: payload?.category, recovery: payload?.recovery,
    retryable: payload?.retryable,
    correlationId: payload?.correlationId,
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(scopedPath(path), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const payload = await response.json().catch(() => ({})) as { error?: ErrorPayload } & T;
  if (!response.ok) throw apiError(payload.error, response.status);
  return payload;
}

async function requestArchive(path: string, init?: RequestInit): Promise<File> {
  const response = await fetch(scopedPath(path), init);
  if (!response.ok) { const payload = await response.json().catch(() => ({})); throw apiError(payload.error, response.status); }
  return new File([await response.blob()], 'workspace.rhiza', { type: 'application/vnd.rhiza.workspace+zip' });
}

export type RuntimeStreamEvent =
  | { type: 'RUN_CREATED'; runId: string }
  | { type: 'RUN_START'; requestId: string; manifestId: string; model: string; provider: string }
  | { type: 'CONTENT_DELTA'; requestId: string; delta: string }
  | { type: 'REASONING_DELTA'; requestId: string; delta: string }
  | { type: 'TOOL_CALL_DELTA'; requestId: string; toolCall: ToolCall }
  | { type: 'USAGE'; requestId: string; usage: TokenUsage }
  | { type: 'RUN_END'; requestId: string; text: string; model: string; provider: string; reasoning?: string; toolCalls?: ToolCall[]; usage?: TokenUsage }
  | { type: 'RUN_ERROR'; requestId: string; code: string; message: string; status: number; category?: ApiErrorCategory; retryable?: boolean; correlationId?: string };

type ChatCommit = { type: 'COMMIT'; userMessage: Message; assistantMessage: Message; manifest: ContextManifest };

export interface ChatRequestOptions {
  idempotencyKey?: string;
  parentRunRef?: string;
  onRunCreated?: (runId: string) => void;
  signal?: AbortSignal;
  attachmentIds?: string[];
  generation?: GenerationOptions;
  operation?: ChatOperation;
  sourceMessageId?: string;
}

export type CollaborationStreamEvent = ({ collaborationId: string; participantId: string; round: number } & RuntimeStreamEvent) | { type: 'COLLABORATION_STATE'; collaborationId: string; revision: number; status: CollaborationRecord['status']; budget: CollaborationRecord['budget']; attempts: CollaborationRecord['attempts'] };

async function streamRequest<T, E extends { type: string } = RuntimeStreamEvent>(path: string, body: unknown, onEvent: (event: E) => void, options: ChatRequestOptions = {}, resultType = 'COMMIT', channel = 'runtime'): Promise<T> {
  let response: Response;
  try {
    response = await fetch(scopedPath(path), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'Idempotency-Key': options.idempotencyKey ?? crypto.randomUUID() }, body: JSON.stringify(body), signal: options.signal });
  } catch (error) {
    if (options.signal?.aborted) throw new ApiError('已停止接收生成，请查看执行历史确认状态。', 'GENERATION_STOPPED', 499);
    throw error;
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: ErrorPayload };
    throw apiError(payload.error, response.status);
  }
  if (!response.body) throw new ApiError('浏览器未收到可读取的 AI 事件流。', 'STREAM_UNAVAILABLE', 502);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let commit: (T & { type: string }) | undefined;
  let streamError: Extract<RuntimeStreamEvent, { type: 'RUN_ERROR' }> | undefined;

  const consumeFrame = (frame: string) => {
    const lines = frame.split(/\r?\n/);
    const eventName = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    let payload: { type: string };
    try { payload = JSON.parse(data) as { type: string }; } catch { return; }
    if (eventName === 'commit' && payload.type === resultType) commit = payload as unknown as T & { type: string };
    if (eventName === channel && payload.type !== resultType) {
      if (channel === 'runtime' && payload.type === 'RUN_CREATED') options.onRunCreated?.((payload as Extract<RuntimeStreamEvent, { type: 'RUN_CREATED' }>).runId);
      onEvent(payload as E);
      if (channel === 'runtime' && payload.type === 'RUN_ERROR') streamError = payload as Extract<RuntimeStreamEvent, { type: 'RUN_ERROR' }>;
    }
    if (eventName === 'error' && payload.type === 'COLLABORATION_ERROR') streamError = payload as Extract<RuntimeStreamEvent, { type: 'RUN_ERROR' }>;

  };

  while (true) {
    let chunk;
    try { chunk = await reader.read(); } catch (error) {
      if (options.signal?.aborted) throw new ApiError('已停止接收生成，请查看执行历史确认状态。', 'GENERATION_STOPPED', 499);
      throw error;
    }
    const { done, value } = chunk;
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || '';
    frames.forEach(consumeFrame);
    if (done) break;
  }
  if (buffer.trim()) consumeFrame(buffer);
  if (streamError) throw new ApiError(streamError.message, streamError.code, streamError.status, { category: streamError.category, retryable: streamError.retryable, correlationId: streamError.correlationId });
  if (!commit) throw new ApiError('AI 事件流结束前未提交消息。', 'INCOMPLETE_STREAM', 502);
  const result = { ...commit };Reflect.deleteProperty(result,'type');
  return result as T;
}

async function streamMessage(message: string, onEvent: (event: RuntimeStreamEvent) => void, options: ChatRequestOptions = {}): Promise<Omit<ChatCommit,'type'>> {
  return streamRequest('/api/chat/stream',{ message,attachmentIds: options.attachmentIds,generation: options.generation,operation: options.operation,sourceMessageId: options.sourceMessageId,parentRunRef: options.parentRunRef },onEvent,options);
}
type TemporaryInput = { sourceNodeId: string; anchorText: string; message: string; history: Array<Pick<Message,'kind' | 'text'>> };
async function streamTemporaryMessage(input: TemporaryInput,onEvent: (event: RuntimeStreamEvent) => void,options: ChatRequestOptions = {}): Promise<{ userMessage: Message; assistantMessage: Message; model: string }> {
  return streamRequest('/api/temp-chat/stream',input,onEvent,options,'TEMP_RESULT');
}
/** Abort transport first; resolve its durable identity in the original Workspace without dispatching again. */
async function findAttemptRun(commandId: string, workspaceId = currentWorkspaceId) {
  const prefix = workspaceId ? `/api/v1/workspaces/${encodeURIComponent(workspaceId)}` : '/api';
  return (await request<{ run: import('./types').ExecutionRun | null }>(`${prefix}/runs/by-command/${encodeURIComponent(commandId)}?idempotencyKey=true`)).run;
}
async function cancelAttempt(commandId: string,runId?: string,workspaceId = currentWorkspaceId) {
  const prefix = workspaceId ? `/api/v1/workspaces/${encodeURIComponent(workspaceId)}` : '/api';
  for (let attempt=0;attempt<5;attempt++) {
    const run = runId ? { id: runId,status: 'running' } : await findAttemptRun(commandId,workspaceId);
    if (run) { if (['created','dispatching','running'].includes(run.status)) await request(`${prefix}/runs/${encodeURIComponent(run.id)}/cancel`,{ method:'POST' }); return; }
    await new Promise(resolve => setTimeout(resolve,200*(attempt+1)));
  }
  throw new ApiError('停止状态待确认，请查看执行历史。','RUN_LOOKUP_PENDING',409);
}

async function uploadAttachment(file: File): Promise<Attachment> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  const result = await request<{ attachment: Attachment }>('/api/attachments', { method: 'POST', body: JSON.stringify({ name: file.name, mimeType: file.type || 'application/octet-stream', dataBase64: btoa(binary) }) });
  return result.attachment;
}

export const api = {
  listCollaborations: () => request<{ collaborations: CollaborationRecord[] }>('/api/collaborations?limit=100'),
  getCollaboration: (id: string) => request<{ collaboration: CollaborationRecord }>(`/api/collaborations/${encodeURIComponent(id)}`),
  createCollaboration: (input: CollaborationInput, key: string) => request<{ collaboration: CollaborationRecord }>('/api/collaborations', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(input) }),
  streamCollaboration: (id: string, onEvent: (event: CollaborationStreamEvent) => void, key: string, signal: AbortSignal) => streamRequest<{ collaboration: CollaborationRecord }, CollaborationStreamEvent>(`/api/collaborations/${encodeURIComponent(id)}/stream`, {}, onEvent, { idempotencyKey: key, signal }, 'COLLABORATION_COMMIT', 'collaboration'),
  retryCollaborationParticipant: (id: string, attemptId: string, key: string, signal: AbortSignal) => request<{ collaboration: CollaborationRecord }>(`/api/collaborations/${encodeURIComponent(id)}/retry`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ attemptId }), signal }),
  stopCollaboration: (id: string, key: string) => request<{ collaboration: CollaborationRecord }>(`/api/collaborations/${encodeURIComponent(id)}/stop`, { method: 'POST', headers: { 'Idempotency-Key': key } }),
  synthesizeCollaboration: (id: string, key: string, signal: AbortSignal) => request<{ collaboration: CollaborationRecord }>(`/api/collaborations/${encodeURIComponent(id)}/synthesize`, { method: 'POST', headers: { 'Idempotency-Key': key }, signal }),
  retainCollaboration: (id: string, targetNodeId: string, key: string) => request<{ message: Message }>(`/api/collaborations/${encodeURIComponent(id)}/retain`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ targetNodeId }) }),

  getContextPreview: (query = '', attachmentIds: string[] = []) => {
    const parameters = new URLSearchParams({ query });
    if (attachmentIds.length) parameters.set('attachmentIds', attachmentIds.join(','));
    return request<import('./types').ContextPreview>(`/api/workspace/context/preview?${parameters}`);
  },
  decideContextRecommendation: (decision: import('./types').ContextRecommendationDecision, idempotencyKey: string) => request<{ workspace: WorkspaceSnapshot }>('/api/workspace/context/decisions', {
    method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(decision),
  }),
  getReplayPreflight: (runId: string) => request<import('./types').ReplayPreflight>(`/api/runs/${encodeURIComponent(runId)}/replay/preflight`),
  previewWorkspaceBundle: (file: File, mappings?: import('./types').BundleMappingChoice[]) => request<import('./types').BundlePreview>('/api/bundle/preview', {
    method: 'POST', headers: { 'Content-Type': 'application/vnd.rhiza.workspace+zip', ...(mappings ? { 'X-Rhiza-Bundle-Mappings': JSON.stringify(mappings) } : {}) }, body: file,
  }),
  hydrateWorkspaceBundle: (file: File, resources: Record<string, File>) => { const body = new FormData(); body.append('bundle', file); for (const [id, resource] of Object.entries(resources)) body.append(`resource:${id}`, resource); return requestArchive('/api/bundle/hydrate', { method: 'POST', body }); },
  listManagedBackups: () => request<import('./types').ManagedBackupList>('/api/backups'),
  createManagedBackup: (key: string, retryOf?: string) => request<import('./types').ManagedBackup>('/api/backups', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ retryOf }) }),
  getManagedBackupArchive: (id: string) => requestArchive(`/api/backups/${encodeURIComponent(id)}/archive`),
  getPersonalGraphView: () => request<import('./types').PersonalGraphView>('/api/graph/views/conversation'),
  savePersonalGraphView: (input: import('./types').GraphViewInput, expectedRevision: number, key: string) => request<Pick<import('./types').PersonalGraphView, 'viewType' | 'revision' | 'ownerScope'>>('/api/graph/views/conversation', { method: 'PUT', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ ...input, expectedRevision }) }),
  batchGraphOperations: (items: import('./types').GraphBatchItem[], key: string) => request<import('./types').GraphBatchResult>('/api/graph/batches', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ items }) }),
  getGraphBatch: (id: string) => request<import('./types').GraphBatchResult>(`/api/graph/batches/${encodeURIComponent(id)}`),
  undoGraphBatch: (id: string, key: string) => request<import('./types').GraphBatchResult>(`/api/graph/batches/${encodeURIComponent(id)}/undo`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: '{}' }),
  replayRun: (runId: string, policy: 'exact' | 'partial' | 'current-model', idempotencyKey: string) => request<{ replay: { classification: 'exact' | 'partial' | 'current-model' } }>(`/api/runs/${encodeURIComponent(runId)}/replay`, {
    method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ policy }),
  }),
  getProvenance: (outputId: string) => request<import('./types').ProvenanceLink>(`/api/objects/${encodeURIComponent(outputId)}/provenance`),
  importWorkspaceBundle: (file: File, idempotencyKey: string, mappings?: import('./types').BundleMappingChoice[]) => request<{ workspaceId: string; importId: string; executionConfiguration: import('./types').BundleExecutionConfiguration }>('/api/bundle/import', {
    method: 'POST', headers: { 'Content-Type': 'application/vnd.rhiza.workspace+zip', 'Idempotency-Key': idempotencyKey, ...(mappings ? { 'X-Rhiza-Bundle-Mappings': JSON.stringify(mappings) } : {}) }, body: file,
  }),
  listRuns: () => request<{ runs: import('./types').ExecutionRun[] }>('/api/runs'),
  getRun: (runId: string) => request<{ run: import('./types').ExecutionRun }>(`/api/runs/${encodeURIComponent(runId)}`),
  cancelRun: (runId: string) => request<{ run: import('./types').ExecutionRun }>(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' }),
  setWorkspace: (workspaceId?: string) => { currentWorkspaceId = workspaceId; },
  listWorkspaces: (includeArchived = false) => request<{ workspaces: WorkspaceRecord[] }>(`/api/v1/workspaces${includeArchived ? '?includeArchived=true' : ''}`),
  createWorkspace: (name: string, idempotencyKey?: string) => request<{ workspace: WorkspaceRecord }>('/api/v1/workspaces', { method: 'POST', headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined, body: JSON.stringify({ name }) }),
  getScopedWorkspace: (workspaceId: string) => request<{ workspace: WorkspaceSnapshot }>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}`),
  updateWorkspace: (workspaceId: string, action: 'archive' | 'restore' | 'rename', revision: number, name?: string) => request<{ workspace: WorkspaceRecord }>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}`, { method: 'PATCH', headers: { 'If-Match': String(revision) }, body: JSON.stringify({ action, name }) }),
  getWorkspace: () => request<{ workspace: WorkspaceSnapshot; provider: ProviderStatus; providerCatalog: ProviderCatalog }>('/api/workspace'),
  getWorkspaceActivity: (limit = 50) => request<{ activity: WorkspaceActivityItem[] }>(`/api/workspace/activity?limit=${limit}`),
  getGraphNeighborhood: (input: { objectId?: string; depth?: number; nodeLimit?: number; edgeLimit?: number; cursor?: string; objectTypes?: string[]; query?:string; statuses?:string[]; updatedAfter?:string } = {}) => {
    const parameters = new URLSearchParams({ objectTypes: input.objectTypes?.join(',')??'conversation', depth: String(input.depth ?? 3), nodeLimit: String(input.nodeLimit ?? 500), edgeLimit: String(input.edgeLimit ?? 2000) });
    if (input.objectId) { parameters.set('objectType', 'conversation'); parameters.set('objectId', input.objectId); }
    if (input.cursor) parameters.set('cursor', input.cursor);
    if(input.query)parameters.set('q',input.query);if(input.statuses?.length)parameters.set('statuses',input.statuses.join(','));if(input.updatedAfter)parameters.set('updatedAfter',input.updatedAfter);
    return request<{ graph: import('./types').GraphProjectionResult }>(`/api/graph/neighborhood?${parameters}`);
  },
  getGraphPath: (fromId:string,toId:string) => request<{graph:import('./types').GraphProjectionResult}>(`/api/graph/path?${new URLSearchParams({fromId,toId,nodeLimit:'500'})}`),
  setMode: (mode: ContextMode) => request<{ workspace: WorkspaceSnapshot }>('/api/workspace/mode', { method: 'PATCH', body: JSON.stringify({ mode }) }),
  getMessageContext: (id: string) => request<ContextHistory>(`/api/messages/${encodeURIComponent(id)}/context`),
  getManifestContext: (manifestId: string) => request<ContextHistory>(`/api/context/manifests/${encodeURIComponent(manifestId)}`),
  setContextStatus: (id: string, status: ContextStatus) => request<{ workspace: WorkspaceSnapshot }>(`/api/workspace/context/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  setContextPin: (id: string, pinned: boolean) => request<{ workspace: WorkspaceSnapshot }>(`/api/workspace/context/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ pinned }) }),
  addContextSource: (sourceType: 'node' | 'segment' | 'file', sourceId: string) => request<{ workspace: WorkspaceSnapshot }>('/api/workspace/context', { method: 'POST', body: JSON.stringify({ sourceType, sourceId }) }),
  sendMessage: (message: string) => request<{ userMessage: Message; assistantMessage: Message; manifest: { id: string } }>('/api/chat', { method: 'POST', body: JSON.stringify({ message }) }),
  streamMessage, streamTemporaryMessage, cancelAttempt, findAttemptRun,
  workspaceId: () => currentWorkspaceId,
  retryRun: (runId: string, idempotencyKey: string, signal?:AbortSignal) => request<Omit<ChatCommit,'type'>>(`/api/runs/${encodeURIComponent(runId)}/retry`,{ method: 'POST', headers: { 'Idempotency-Key': idempotencyKey },signal }),
  searchWorkspace: (query: string) => request<{ results: Array<{ sourceType: 'node' | 'segment'; sourceId: string; nodeId: string; title: string; excerpt: string; titleMatch: boolean }> }>(`/api/search?q=${encodeURIComponent(query)}`),
  renameConversation: (nodeId: string,title: string) => request<{ workspace: WorkspaceSnapshot }>(`/api/nodes/${encodeURIComponent(nodeId)}/title`,{ method:'PATCH',body:JSON.stringify({ title }) }),
  setNodeStatus: (nodeId: string,status: import('./types').DiscussionStatus) => request<{ workspace: WorkspaceSnapshot }>(`/api/nodes/${encodeURIComponent(nodeId)}/status`,{ method:'PATCH',body:JSON.stringify({ status }) }),
  setConversationModel: (nodeId: string,modelId: string | null) => request<{ workspace: WorkspaceSnapshot }>(`/api/nodes/${encodeURIComponent(nodeId)}/model`,{ method:'PATCH',body:JSON.stringify({ modelId }) }),
  setWorkspaceModel: (modelId: string | null) => request<{ workspace: WorkspaceSnapshot }>('/api/workspace/model',{ method:'PATCH',body:JSON.stringify({ modelId }) }),
  updateSegment: (segmentId: string,changes: { title?: string; status?: 'active' | 'archived' }) => request<{ workspace: WorkspaceSnapshot }>(`/api/segments/${encodeURIComponent(segmentId)}`,{ method:'PATCH',body:JSON.stringify(changes) }),
  createSegment: (nodeId: string,title: string,messageIds: string[],range?: { messageId: string; selectedText: string; startOffset: number; endOffset: number }) => request<{ workspace: WorkspaceSnapshot }>(`/api/nodes/${encodeURIComponent(nodeId)}/segments`,{ method:'POST',body:JSON.stringify({ title,messageIds,range }) }),
  uploadAttachment,
  createBranch: (input: { title: string; anchorText?: string; anchorStart?: number; anchorEnd?: number; sourceMessageId?: string; messages?: Array<Pick<Message, 'kind' | 'text' | 'createdAt'>> }) => request<{ workspace: WorkspaceSnapshot }>('/api/nodes', { method: 'POST', body: JSON.stringify(input) }),
  sendTemporaryMessage: (input: { sourceNodeId: string; anchorText: string; message: string; history: Array<Pick<Message, 'kind' | 'text'>> }) => request<{ userMessage: Message; assistantMessage: Message; model: string }>('/api/temp-chat', { method: 'POST', body: JSON.stringify(input) }),
  activateNode: (id: string) => request<{ workspace: WorkspaceSnapshot }>(`/api/nodes/${encodeURIComponent(id)}/activate`, { method: 'POST' }),
  moveNode: (id: string, x: number, y: number) => request<{ workspace: WorkspaceSnapshot }>(`/api/nodes/${encodeURIComponent(id)}/position`, { method: 'PATCH', body: JSON.stringify({ x, y }) }),
  createGraphNode: (input: { title: string; summary?: string; x: number; y: number }) => request<{ workspace: WorkspaceSnapshot }>('/api/graph/nodes', { method: 'POST', body: JSON.stringify(input) }),
  archiveGraphNode: (id: string) => request<{ workspace: WorkspaceSnapshot }>(`/api/graph/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  // Kept for callers that still use the pre-archive method name.
  deleteGraphNode: (id: string) => request<{ workspace: WorkspaceSnapshot }>(`/api/graph/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  restoreGraphNode: (id: string) => request<{ workspace: WorkspaceSnapshot }>(`/api/nodes/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) }),
  purgeGraphNode: (id: string, confirmation: string, reason: string) => request<{ workspace: WorkspaceSnapshot }>(`/api/graph/nodes/${encodeURIComponent(id)}/purge`, { method: 'POST', body: JSON.stringify({ confirmation, reason }) }),
  createGraphEdge: (input: { source: string; target: string; relation: 'derived-from' | 'references' | 'related-to' | 'merged-into'; label: string }) => request<{ workspace: WorkspaceSnapshot }>('/api/graph/edges', { method: 'POST', body: JSON.stringify(input) }),
  deleteGraphEdge: (id: string) => request<{ workspace: WorkspaceSnapshot }>(`/api/graph/edges/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  mergeNode: (id: string, targetNodeId?: string, summary?: string) => request<{ workspace: WorkspaceSnapshot }>(`/api/nodes/${encodeURIComponent(id)}/merge`, { method: 'POST', body: JSON.stringify({ targetNodeId, summary }) }),
  getProviders: () => request<{ catalog: ProviderCatalog; presets: Record<string, ProviderPresetInfo> }>('/api/providers'),
  saveProvider: (input: { id?: string; preset: ProviderPreset; name: string; baseUrl: string; apiKey?: string; allowNoKey: boolean; modelId?: string; displayName?: string }) => {
    const { id, ...body } = input;
    return request<{ catalog: ProviderCatalog }>(id ? `/api/providers/${id}` : '/api/providers', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
  },
  discoverProviderBatch: (providerIds: string[], failedOnly = false) => request<import('./types').ProviderDiscoveryBatchResult>('/api/providers/discover', { method: 'POST', body: JSON.stringify({ providerIds, failedOnly }) }),
  discoverModels: (providerId: string) => request<{ catalog: ProviderCatalog }>(`/api/providers/${providerId}/discover`, { method: 'POST' }),
  updateModel: (modelId: string, changes: { favorite?: boolean; pinned?: boolean }) => request<{ catalog: ProviderCatalog }>(`/api/models/${modelId}`, { method: 'PATCH', body: JSON.stringify(changes) }),
  selectModel: (modelId: string) => request<{ catalog: ProviderCatalog; provider: ProviderStatus }>(`/api/models/${modelId}/select`, { method: 'POST' }),
};
