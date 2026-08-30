import type { Attachment, ChatOperation, ContextManifest, ContextMode, ContextStatus, GenerationOptions, Message, ProviderCatalog, ProviderPreset, ProviderPresetInfo, ProviderStatus, TokenUsage, ToolCall, WorkspaceActivityItem, WorkspaceSnapshot, WorkspaceRecord } from './types';

export type ApiErrorCategory = 'validation' | 'conflict' | 'permission' | 'not_found' | 'infrastructure';

export interface ApiErrorDetails {
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

type ErrorPayload = { code?: string; message?: string; category?: ApiErrorCategory; retryable?: boolean; correlationId?: string };
let currentWorkspaceId: string | undefined;
const scopedPath = (path: string) => currentWorkspaceId && /^\/api\/(?!v1\/workspaces(?:\/|\?|$)|health$|providers|models)/.test(path) ? `/api/v1/workspaces/${encodeURIComponent(currentWorkspaceId)}${path.slice(4)}` : path;

function apiError(payload: ErrorPayload | undefined, status: number) {
  return new ApiError(payload?.message || `请求失败（${status}）`, payload?.code, status, {
    category: payload?.category,
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

type RuntimeStreamEvent =
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
  parentRunRef?: string;
  onRunCreated?: (runId: string) => void;
  signal?: AbortSignal;
  attachmentIds?: string[];
  generation?: GenerationOptions;
  operation?: ChatOperation;
  sourceMessageId?: string;
}

async function streamMessage(message: string, onEvent: (event: RuntimeStreamEvent) => void, options: ChatRequestOptions = {}): Promise<Omit<ChatCommit, 'type'>> {
  let response: Response;
  try {
    response = await fetch(scopedPath('/api/chat/stream'), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ message, attachmentIds: options.attachmentIds, generation: options.generation, operation: options.operation, sourceMessageId: options.sourceMessageId, parentRunRef: options.parentRunRef }), signal: options.signal });
  } catch (error) {
    if (options.signal?.aborted) throw new ApiError('生成已停止，本轮未写入历史。', 'GENERATION_STOPPED', 499);
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
  let commit: ChatCommit | undefined;
  let streamError: Extract<RuntimeStreamEvent, { type: 'RUN_ERROR' }> | undefined;

  const consumeFrame = (frame: string) => {
    const lines = frame.split(/\r?\n/);
    const eventName = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    let payload: RuntimeStreamEvent | ChatCommit;
    try { payload = JSON.parse(data) as RuntimeStreamEvent | ChatCommit; } catch { return; }
    if (eventName === 'commit' && payload.type === 'COMMIT') commit = payload;
    if (eventName === 'runtime' && payload.type !== 'COMMIT') {
      if (payload.type === 'RUN_CREATED') options.onRunCreated?.(payload.runId);
      onEvent(payload);
      if (payload.type === 'RUN_ERROR') streamError = payload;
    }
  };

  while (true) {
    let chunk;
    try { chunk = await reader.read(); } catch (error) {
      if (options.signal?.aborted) throw new ApiError('生成已停止，本轮未写入历史。', 'GENERATION_STOPPED', 499);
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
  return { userMessage: commit.userMessage, assistantMessage: commit.assistantMessage, manifest: commit.manifest };
}

async function uploadAttachment(file: File): Promise<Attachment> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  const result = await request<{ attachment: Attachment }>('/api/attachments', { method: 'POST', body: JSON.stringify({ name: file.name, mimeType: file.type || 'application/octet-stream', dataBase64: btoa(binary) }) });
  return result.attachment;
}

export const api = {
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
  setMode: (mode: ContextMode) => request<{ workspace: WorkspaceSnapshot }>('/api/workspace/mode', { method: 'PATCH', body: JSON.stringify({ mode }) }),
  setContextStatus: (id: string, status: ContextStatus) => request<{ workspace: WorkspaceSnapshot }>(`/api/workspace/context/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  setContextPin: (id: string, pinned: boolean) => request<{ workspace: WorkspaceSnapshot }>(`/api/workspace/context/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ pinned }) }),
  addContextSource: (sourceType: 'node' | 'segment' | 'file', sourceId: string) => request<{ workspace: WorkspaceSnapshot }>('/api/workspace/context', { method: 'POST', body: JSON.stringify({ sourceType, sourceId }) }),
  sendMessage: (message: string) => request<{ userMessage: Message; assistantMessage: Message; manifest: { id: string } }>('/api/chat', { method: 'POST', body: JSON.stringify({ message }) }),
  streamMessage,
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
  createGraphEdge: (input: { source: string; target: string; relation: 'derived-from' | 'references' | 'related-to' | 'merged-into'; label: string }) => request<{ workspace: WorkspaceSnapshot }>('/api/graph/edges', { method: 'POST', body: JSON.stringify(input) }),
  deleteGraphEdge: (id: string) => request<{ workspace: WorkspaceSnapshot }>(`/api/graph/edges/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  mergeNode: (id: string, targetNodeId?: string, summary?: string) => request<{ workspace: WorkspaceSnapshot }>(`/api/nodes/${encodeURIComponent(id)}/merge`, { method: 'POST', body: JSON.stringify({ targetNodeId, summary }) }),
  getProviders: () => request<{ catalog: ProviderCatalog; presets: Record<string, ProviderPresetInfo> }>('/api/providers'),
  saveProvider: (input: { id?: string; preset: ProviderPreset; name: string; baseUrl: string; apiKey?: string; allowNoKey: boolean; modelId?: string; displayName?: string }) => {
    const { id, ...body } = input;
    return request<{ catalog: ProviderCatalog }>(id ? `/api/providers/${id}` : '/api/providers', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
  },
  discoverModels: (providerId: string) => request<{ catalog: ProviderCatalog }>(`/api/providers/${providerId}/discover`, { method: 'POST' }),
  updateModel: (modelId: string, changes: { favorite?: boolean; pinned?: boolean }) => request<{ catalog: ProviderCatalog }>(`/api/models/${modelId}`, { method: 'PATCH', body: JSON.stringify(changes) }),
  selectModel: (modelId: string) => request<{ catalog: ProviderCatalog; provider: ProviderStatus }>(`/api/models/${modelId}/select`, { method: 'POST' }),
};
