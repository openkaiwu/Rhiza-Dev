import { ApplicationError, applicationError } from '../contracts/application-error';
import type { Application, CommandEnvelope, CommandExecutionOptions, CommandMap, CommandResult, CommandType, QueryEnvelope, QueryMap, QueryResult, QueryType } from '../contracts/application';
import type { AuditEvent, ChatOperation, ContextManifest, ContextMode, ContextStatus, GenerationOptions, StoredAttachment, StoredMessage, WorkspaceData } from '../domain';
import { deriveVersionIdentity } from '../domain/message-version';
import type { ContextPlannerPort } from '../context-runtime/port';
import type { LegacyTextExtractionPort, LegacyUploadPort } from './ports/legacy-upload';
import type { ProviderManagementPort } from './ports/provider-management';
import type { RuntimePort, RuntimeRequest } from './ports/runtime';
import type { WorkspaceUnitOfWork } from './ports/workspace-unit-of-work';
import { WorkspaceDirectory } from '../identity/workspace-directory';

const nodeStatuses = new Set(['draft', 'active', 'resolved', 'stale', 'archived']);
const textMimeTypes = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/xml', 'text/xml', 'application/javascript', 'text/javascript']);

export interface RhizaApplicationDependencies {
  unitOfWork: WorkspaceUnitOfWork;
  runtime: RuntimePort;
  providers: ProviderManagementPort;
  uploads: LegacyUploadPort;
  textExtraction: LegacyTextExtractionPort;
  planner: ContextPlannerPort;
  id: () => string;
  now: () => string;
  log?: { error(message: string, error?: unknown): void };
  contextTokenBudget?: number;
  workspaceDirectory?: WorkspaceDirectory;
}

type Completion = { text: string; model: string; provider: string; reasoning?: string; toolCalls?: StoredMessage['toolCalls']; usage?: StoredMessage['usage'] };
type PreparedRun = { manifest: ContextManifest; request: RuntimeRequest; createdAt: string; userMessageId: string; versionGroupId: string; version: number };
type AnyCommandEnvelope = { [K in CommandType]: Omit<CommandEnvelope<K>, 'commandType' | 'payload'> & { commandType: K; payload: CommandMap[K]['payload'] } }[CommandType];
type AnyQueryEnvelope = { [K in QueryType]: Omit<QueryEnvelope<K>, 'queryType' | 'payload'> & { queryType: K; payload: QueryMap[K]['payload'] } }[QueryType];
type DispatchPayload = {
  body: unknown; providerId?: string; modelId: string; favorite?: boolean; pinned?: boolean;
  name: string; mimeType: string; bytes: Uint8Array; prompt: string; operation: ChatOperation; sourceMessageId?: string; attachmentIds: string[]; generation: GenerationOptions;
  mode: ContextMode; contextItemId: string; status?: ContextStatus; sourceType: 'node' | 'segment' | 'file'; sourceId: string; anchorText: string;
  title: string; summary?: string; x?: number; y?: number; nodeId: string; messageIds: string[]; positions: Array<{ nodeId: string; x: number; y: number }>;
  source: string; target: string; relation: 'derived-from' | 'references' | 'related-to' | 'merged-into'; label?: string; edgeId: string;
  sourceNodeId: string; targetNodeId?: string; confirmation: string; reason: string; messages?: Array<{ kind: 'user' | 'assistant'; text: string; createdAt?: string }>; history?: Array<{ kind: 'user' | 'assistant'; text: string; createdAt?: string }>; attachmentId: string;
};

function legacyError(message: string, status: number, code: string): ApplicationError {
  const category = status === 404 ? 'not_found' : status === 409 ? 'conflict' : status >= 500 ? 'infrastructure' : 'validation';
  const recovery = code.includes('ARCHIVED') ? 'restore_node' : code.includes('MODEL_NOT') ? 'select_model' : status >= 500 ? 'retry' : 'none';
  return applicationError(message, code, category, recovery, status >= 500, status);
}

function runtimeError(message: string, status: number, code: string): ApplicationError {
  const safeMessage = code === 'PROVIDER_NOT_CONFIGURED'
    ? '尚未配置第三方 AI。请在模型设置中配置供应商和模型。'
    : code === 'GENERATION_STOPPED'
      ? '生成已停止。'
      : code === 'PROVIDER_TIMEOUT'
        ? '第三方 AI 请求超时，请检查网络或稍后重试。'
        : 'AI Runtime 执行失败，请稍后重试。';
  return new ApplicationError(safeMessage, {
    code, status, category: 'infrastructure', recovery: code === 'PROVIDER_NOT_CONFIGURED' ? 'select_model' : 'retry', retryable: status >= 500,
    cause: message,
  });
}

function asApplicationError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) return error;
  if (error && typeof error === 'object' && 'message' in error && 'code' in error && 'status' in error) {
    const legacy = error as { message: string; code: string; status: number };
    return legacy.status >= 500 || /^(?:PROVIDER_|RUNTIME_|GENERATION_)/.test(legacy.code)
      ? runtimeError(legacy.message, legacy.status, legacy.code)
      : legacyError(legacy.message, legacy.status, legacy.code);
  }
  return new ApplicationError('服务器处理请求时发生错误。', { code: 'INTERNAL_ERROR', category: 'infrastructure', recovery: 'retry', retryable: true, status: 500, cause: error });
}

function withCurrentNodeContext(workspace: WorkspaceData, nodeId: string, planner: ContextPlannerPort): WorkspaceData {
  const existing = workspace.contextItems.find(item => item.sourceType === 'node' && item.sourceId === nodeId);
  const contextItems = workspace.contextItems.map(item => item.selectionMode === 'CURRENT' && item.sourceId !== nodeId
    ? { ...item, selectionMode: 'USER_SELECTED' as const, status: item.pinned ? item.status : 'recommended' as const, reason: item.pinned ? item.reason : '已离开该节点，可按需重新加入。' }
    : item);
  if (existing) return { ...workspace, contextItems: contextItems.map(item => item.id === existing.id ? { ...item, status: 'active' as const, selectionMode: 'CURRENT' as const, reason: '当前讨论节点始终进入本轮上下文。' } : item) };
  const item = planner.sourceItem(workspace, 'node', nodeId);
  return { ...workspace, contextItems: [...contextItems, { ...item, selectionMode: 'CURRENT', reason: '当前讨论节点始终进入本轮上下文。' }] };
}

export function createRhizaApplication(dependencies: RhizaApplicationDependencies): Application {
  const { unitOfWork, runtime, providers, uploads, textExtraction, planner, id, now, log } = dependencies;
  const fallbackWorkspaces = new Map<string, import('../contracts/application').WorkspaceRecord>([['00000000-0000-4000-8000-000000000001', { workspaceId: '00000000-0000-4000-8000-000000000001', name: 'Rhiza 产品研究', status: 'active', createdBy: '00000000-0000-4000-8000-000000000002', revision: 1 }]]);
  const workspaceDirectory = dependencies.workspaceDirectory ?? new WorkspaceDirectory({
    listWorkspaces: async (userId, includeArchived = false) => [...fallbackWorkspaces.values()].filter(item => item.createdBy === userId && (includeArchived || item.status === 'active')),
    createWorkspace: async record => { fallbackWorkspaces.set(record.workspaceId, record); }, updateWorkspace: async record => { fallbackWorkspaces.set(record.workspaceId, record); },
  });
  const budget = dependencies.contextTokenBudget ?? 32_000;
  const activeModel = async () => {
    const model = (await runtime.listModels()).find(item => item.active);
    if (!model) throw legacyError('请先在模型设置中选择一个模型。', 503, 'MODEL_NOT_SELECTED');
    return model;
  };
  const mutate = async <T>(work: (current: WorkspaceData) => { next: WorkspaceData; value: T }, purge?: { nodeId: string; auditReceiptId: string }) =>
    unitOfWork.execute({ policy: purge ? { kind: 'purge', ...purge } : { kind: 'normal' }, apply: current => work(current) });
  const mutateWorkspace = async (work: (current: WorkspaceData) => { next: WorkspaceData; value: unknown }) => (await mutate(work)).workspace;

  const prepareRun = async (payload: Extract<CommandEnvelope<'CreateConversationRun'>['payload'], object>): Promise<PreparedRun> => {
    const current = await unitOfWork.read(workspace => workspace);
    const nodeId = current.activeNodeId;
    const node = current.discussionNodes.find(item => item.id === nodeId);
    if (!node) throw legacyError('当前讨论节点不存在。', 404, 'NODE_NOT_FOUND');
    if (node.status === 'archived') throw legacyError('归档节点为只读，请先恢复后再继续讨论。', 409, 'NODE_ARCHIVED');
    let plan: ReturnType<ContextPlannerPort['plan']>;
    try { plan = planner.plan(current, payload.prompt, payload.attachmentIds, budget); }
    catch (error) {
      log?.error('[planner] degraded to explicit context', error);
      const items = current.contextItems.filter(item => item.status === 'active');
      plan = { items, diagnostics: { candidateCount: 0, selectedCount: items.length, elapsedMs: 0, fallback: true, budget, usedTokens: items.reduce((sum, item) => sum + item.tokens, 0) } };
    }
    const source = payload.sourceMessageId ? current.messages.find(message => message.id === payload.sourceMessageId && message.nodeId === nodeId) : undefined;
    if (payload.sourceMessageId && !source) throw legacyError('版本来源消息不存在或不属于当前讨论。', 400, 'INVALID_MESSAGE_SOURCE');
    if (payload.operation === 'edit-resend' && source?.kind !== 'user') throw legacyError('Edit & Resend 的来源必须是用户消息。', 400, 'INVALID_EDIT_SOURCE');
    if (payload.operation === 'regenerate' && source?.kind !== 'assistant') throw legacyError('Regenerate 的来源必须是 AI 消息。', 400, 'INVALID_REGENERATE_SOURCE');
    let prompt = payload.prompt;
    let history = current.messages.filter(message => message.nodeId === nodeId);
    if (payload.operation === 'regenerate' && source) {
      const sourceIndex = history.findIndex(message => message.id === source.id);
      const prior = source.replyToMessageId ? history.find(message => message.id === source.replyToMessageId) : [...history.slice(0, sourceIndex)].reverse().find(message => message.kind === 'user');
      if (!prior) throw legacyError('无法找到 Regenerate 对应的用户消息。', 409, 'REGENERATE_PROMPT_MISSING');
      prompt = prior.text; history = history.slice(0, history.findIndex(message => message.id === prior.id));
    } else if (payload.operation === 'edit-resend' && source) history = history.slice(0, history.findIndex(message => message.id === source.id));
    const userMessageId = id();
    const version = deriveVersionIdentity({ operation: payload.operation, userMessageId, source, messages: current.messages });
    const attachments = payload.attachmentIds.map(attachmentId => current.attachments.find(item => item.id === attachmentId));
    if (attachments.some(item => !item)) throw legacyError('存在无效附件，请重新选择文件。', 400, 'ATTACHMENT_NOT_FOUND');
    const model = await activeModel(); const createdAt = now(); const requestId = id(); const manifestId = id();
    const manifest: ContextManifest = {
      id: manifestId, projectId: current.projectId, nodeId, requestId, createdAt, mode: current.mode, model: model.model, provider: model.provider, runtime: runtime.kind || 'provider-adapter',
      contextItemIds: current.contextItems.filter(item => item.status === 'active').map(item => item.id), excludedItemIds: current.contextItems.filter(item => item.status === 'excluded').map(item => item.id),
      contextItems: plan.items.map(item => ({ sourceType: item.sourceType || 'reference', sourceId: item.sourceId || item.id, sourceNodeId: item.sourceNodeId, title: item.title, detail: item.detail, role: item.role, selectionMode: item.selectionMode || 'CURRENT', pinned: Boolean(item.pinned), reason: item.reason || (item.selectionMode === 'CURRENT' ? '当前讨论节点。' : '已加入 Active Context。'), tokenCount: item.tokens, contentVersion: item.contentVersion || 1 })),
      estimatedTokens: plan.items.reduce((sum, item) => sum + item.tokens, 0), generation: payload.generation, operation: payload.operation, sourceMessageId: payload.sourceMessageId, attachmentIds: payload.attachmentIds, planner: plan.diagnostics,
    };
    return { manifest, createdAt, userMessageId, versionGroupId: version.versionGroupId, version: version.version, request: { requestId, manifestId, projectId: current.projectId, nodeId, modelId: model.id, prompt, history, contextItems: plan.items, mode: current.mode, attachments: attachments.filter((item): item is StoredAttachment => Boolean(item)), generation: payload.generation, operation: payload.operation, sourceMessageId: payload.sourceMessageId } };
  };

  const commitRun = async (run: PreparedRun, completion: Completion) => {
    const operation = run.request.operation || 'send';
    const userMessage: StoredMessage = { id: run.userMessageId, nodeId: run.request.nodeId, kind: 'user', text: run.request.prompt, createdAt: run.createdAt, attachmentIds: run.manifest.attachmentIds, operation, sourceMessageId: run.request.sourceMessageId, versionGroupId: run.versionGroupId, version: run.version };
    const assistantMessage: StoredMessage = { id: id(), nodeId: run.request.nodeId, kind: 'assistant', text: completion.text, createdAt: run.createdAt, manifestId: run.manifest.id, operation, sourceMessageId: operation === 'regenerate' ? run.request.sourceMessageId : undefined, versionGroupId: run.versionGroupId, version: run.version, replyToMessageId: userMessage.id, usage: completion.usage, reasoning: completion.reasoning, toolCalls: completion.toolCalls };
    const committed = await mutate(current => {
      if (current.manifests.some(manifest => manifest.requestId === run.request.requestId)) return { next: current, value: { userMessage, assistantMessage, manifest: run.manifest } };
      const target = current.discussionNodes.find(node => node.id === run.request.nodeId);
      if (!target) throw legacyError('生成期间讨论节点已被删除，结果未写入。', 409, 'NODE_REMOVED_DURING_RUN');
      if (target.status === 'archived') throw legacyError('生成期间讨论节点已归档，结果未写入。', 409, 'NODE_ARCHIVED_DURING_RUN');
      return { next: { ...current, messages: [...current.messages, userMessage, assistantMessage], manifests: [...current.manifests, run.manifest] }, value: { userMessage, assistantMessage, manifest: run.manifest } };
    });
    return committed.value;
  };

  const dispatch = async (envelope: AnyCommandEnvelope, options?: CommandExecutionOptions): Promise<unknown> => {
    try {
      if (!envelope.actor || !envelope.scope || !envelope.workspaceId) throw legacyError('写命令必须提供 ActorRef 与 ScopeRef。', 403, 'MISSING_ACTOR_OR_SCOPE');
      const record = await workspaceDirectory.require(envelope.actor, envelope.workspaceId, envelope.scope);
      if (record.status === 'archived' && !['RestoreWorkspace'].includes(envelope.commandType)) throw legacyError('归档工作区为只读，请先恢复。', 409, 'WORKSPACE_ARCHIVED');
      if (envelope.expectedRevision !== undefined && envelope.expectedRevision !== record.revision) throw legacyError('工作区版本已变化，请刷新后重试。', 409, 'WORKSPACE_REVISION_CONFLICT');
      if (envelope.commandType === 'CreateWorkspace') {
        const name = String((envelope.payload as { name?: string }).name || '').trim();
        if (!name || name.length > 200) throw legacyError('工作区名称不能为空且不能超过 200 字符。', 400, 'INVALID_WORKSPACE_NAME');
        const workspaceId = id(); const created = await workspaceDirectory.create(envelope.actor, workspaceId, name);
        await unitOfWork.createWorkspace?.(workspaceId, name);
        return created;
      }
      if (envelope.commandType === 'RenameWorkspace') return workspaceDirectory.rename(record, String((envelope.payload as { name?: string }).name || '').trim());
      if (envelope.commandType === 'ArchiveWorkspace') return workspaceDirectory.status(record, 'archived');
      if (envelope.commandType === 'RestoreWorkspace') return workspaceDirectory.status(record, 'active');
      if (envelope.commandType === 'SwitchWorkspace') return record;
      if (unitOfWork.withWorkspace) return unitOfWork.withWorkspace(envelope.workspaceId, () => dispatchScoped(envelope, options));
      return dispatchScoped(envelope, options);
    } catch (error) { throw asApplicationError(error); }
  };

  const dispatchScoped = async (envelope: AnyCommandEnvelope, options?: CommandExecutionOptions): Promise<unknown> => {
    try {
      // The public generic envelope cannot be narrowed by a switch in TS 6;
      // dispatch remains exhaustive while each runtime key maps to its contract payload.
      const payload = envelope.payload as unknown as DispatchPayload;
      switch (envelope.commandType) {
        case 'SaveProvider': return providers.saveProvider(payload.body as never, payload.providerId);
        case 'DiscoverProviderModels': return providers.discoverModels(payload.providerId!);
        case 'UpdateModelPreference': return providers.updateModel(payload.modelId, { favorite: payload.favorite, pinned: payload.pinned });
        case 'SelectModel': return providers.selectModel(payload.modelId);
        case 'RegisterLegacyAttachment': {
          const snapshot = await providers.snapshot();
          if (!payload.name || !payload.bytes.length) throw legacyError('附件名称或内容无效。', 400, 'INVALID_ATTACHMENT');
          if (payload.bytes.length > snapshot.filePolicy.maxFileSizeBytes) throw legacyError(`附件大小必须在 1 字节到 ${snapshot.filePolicy.maxFileSizeBytes} 字节之间。`, 413, 'ATTACHMENT_TOO_LARGE');
          if (snapshot.filePolicy.supportedMimeTypes.length && !snapshot.filePolicy.supportedMimeTypes.includes(payload.mimeType)) throw legacyError(`当前模型不支持 ${payload.mimeType}。`, 415, 'UNSUPPORTED_ATTACHMENT');
          const attachmentId = id();
          try {
            await uploads.put(attachmentId, payload.bytes);
            const indexable = textMimeTypes.has(payload.mimeType) || payload.mimeType.startsWith('text/') || payload.mimeType === 'application/pdf';
            const extracted = indexable ? await textExtraction.extractText(payload.mimeType, payload.bytes) : '';
            const processed = planner.processAttachment(attachmentId, payload.name, payload.mimeType, extracted);
            const attachment: StoredAttachment = { id: attachmentId, name: payload.name, mimeType: payload.mimeType, size: payload.bytes.length, kind: payload.mimeType.startsWith('image/') ? 'image' : 'file', summary: processed.summary, chunkCount: processed.chunks.length, ...(extracted && payload.bytes.length <= 100_000 ? { extractedText: extracted } : {}), createdAt: now() };
            await mutate(current => ({ next: { ...current, attachments: [...current.attachments, attachment], fileChunks: [...current.fileChunks, ...processed.chunks] }, value: attachment }));
            const safeAttachment = {
              id: attachment.id, name: attachment.name, mimeType: attachment.mimeType, size: attachment.size,
              kind: attachment.kind, summary: attachment.summary, chunkCount: attachment.chunkCount, createdAt: attachment.createdAt,
            };
            return { attachment: safeAttachment };
          } catch (error) {
            try { await uploads.delete?.(attachmentId); } catch (cleanupError) { log?.error('[attachment] cleanup failed', cleanupError); }
            throw error;
          }
        }
        case 'CreateConversationRun': {
          const run = await prepareRun(payload); run.request.signal = options?.signal; await options?.onReady?.();
          for await (const event of runtime.generate(run.request)) {
            if (event.type === 'RUN_ERROR') {
              const error = runtimeError(event.message, event.status, event.code);
              await options?.onRuntimeEvent?.({ ...event, message: error.message } as { type: string });
              throw error;
            }
            await options?.onRuntimeEvent?.(event);
            if (event.type === 'RUN_END') return commitRun(run, event);
          }
          throw legacyError('AI Runtime 未返回结束事件。', 502, 'INCOMPLETE_RUNTIME_STREAM');
        }
        case 'ChangeContextMode': {
          if (!['Auto', 'Assisted', 'Strict'].includes(payload.mode)) throw legacyError('无效的 Context 模式。', 400, 'INVALID_MODE');
          return mutateWorkspace(current => ({ next: { ...current, mode: payload.mode }, value: undefined }));
        }
        case 'ChangeContextSelection': return mutateWorkspace(current => {
          let found = false;
          const next = { ...current, contextItems: current.contextItems.map(item => { if (item.id !== payload.contextItemId) return item; found = true; const status = payload.status || (payload.pinned ? 'active' : item.status); return { ...item, status, pinned: payload.pinned ?? item.pinned, ...(item.status === 'recommended' && payload.status === 'active' ? { selectionMode: 'AI_RECOMMENDED_ACCEPTED' as const } : {}), ...(payload.status === 'excluded' ? { pinned: false, reason: '用户显式排除，本轮不会发送给模型。' } : {}) }; }) };
          if (!found) throw legacyError('Context 条目不存在。', 404, 'CONTEXT_NOT_FOUND'); return { next, value: next };
        });
        case 'AddContextSource': return mutateWorkspace(current => { const found = current.contextItems.find(item => item.sourceType === payload.sourceType && item.sourceId === payload.sourceId); const next = found ? { ...current, contextItems: current.contextItems.map(item => item.id === found.id ? { ...item, status: 'active' as const, selectionMode: 'USER_SELECTED' as const, reason: '由用户显式加入。' } : item) } : { ...current, contextItems: [...current.contextItems, planner.sourceItem(current, payload.sourceType, payload.sourceId)] }; return { next, value: undefined }; });
        case 'CreateGraphNode': return mutateWorkspace(current => { const createdAt = now(); const node = { id: id(), title: payload.title, summary: payload.summary || '尚未补充讨论摘要。', status: 'draft' as const, kind: 'branch' as const, x: Math.round(payload.x ?? 180), y: Math.round(payload.y ?? 140), createdAt, updatedAt: createdAt }; const next = { ...current, discussionNodes: [...current.discussionNodes, node] }; return { next, value: undefined }; });
        case 'ActivateNode': return mutateWorkspace(current => { const node = current.discussionNodes.find(item => item.id === payload.nodeId); if (!node) throw legacyError('讨论节点不存在。', 404, 'NODE_NOT_FOUND'); if (node.status === 'archived') throw legacyError('归档节点不能激活，请先恢复。', 409, 'NODE_ARCHIVED'); const next = withCurrentNodeContext({ ...current, activeNodeId: node.id, nodeId: node.id }, node.id, planner); return { next, value: undefined }; });
        case 'ChangeNodeStatus': return mutateWorkspace(current => changeNodeStatus(current, payload.nodeId, payload.status as 'draft' | 'active' | 'resolved' | 'stale' | 'archived', now, planner));
        case 'ArchiveObject': return mutateWorkspace(current => changeNodeStatus(current, payload.nodeId, 'archived', now, planner));
        case 'CreateSegment': { const committed = await mutate(current => { const node = current.discussionNodes.find(item => item.id === payload.nodeId); if (!node) throw legacyError('讨论节点不存在。', 404, 'NODE_NOT_FOUND'); if (node.status === 'archived') throw legacyError('归档节点为只读；请先恢复。', 409, 'NODE_ARCHIVED_READ_ONLY'); if (payload.messageIds.some((messageId: string) => !current.messages.some(message => message.id === messageId && message.nodeId === node.id))) throw legacyError('Segment 只能包含所属节点中的 Event。', 400, 'INVALID_SEGMENT_EVENT'); const segment = { id: id(), nodeId: node.id, ordinal: Math.max(-1, ...current.segments.filter(item => item.nodeId === node.id).map(item => item.ordinal)) + 1, title: payload.title, createdAt: now() }; const workspace = { ...current, segments: [...current.segments, segment], messages: current.messages.map(message => payload.messageIds.includes(message.id) ? { ...message, segmentId: segment.id } : message) }; return { next: workspace, value: segment }; }); return { workspace: committed.workspace, segment: committed.value }; }
        case 'UpdateGraphLayout': return mutateWorkspace(current => { const positions = payload.positions; for (const position of positions) { const node = current.discussionNodes.find(item => item.id === position.nodeId); if (!node) throw legacyError('讨论节点不存在。', 404, 'NODE_NOT_FOUND'); if (node.status === 'archived') throw legacyError('归档节点为只读；请先恢复。', 409, 'NODE_ARCHIVED_READ_ONLY'); if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || position.x < 0 || position.y < 0 || position.x > 5000 || position.y > 5000) throw legacyError('节点坐标无效。', 400, 'INVALID_POSITION'); } const changed = new Map(positions.map(position => [position.nodeId, { ...position, x: Math.round(position.x), y: Math.round(position.y) }])); const next = { ...current, discussionNodes: current.discussionNodes.map(node => changed.has(node.id) ? { ...node, ...changed.get(node.id)!, updatedAt: now() } : node) }; return { next, value: undefined }; });
        case 'CreateRelation': return mutateWorkspace(current => { const source = current.discussionNodes.find(node => node.id === payload.source); const target = current.discussionNodes.find(node => node.id === payload.target); if (!source || !target) throw legacyError('关系节点不存在。', 404, 'NODE_NOT_FOUND'); if (source.status === 'archived' || target.status === 'archived') throw legacyError('归档节点为只读；请先恢复。', 409, 'NODE_ARCHIVED_READ_ONLY'); if (current.discussionEdges.some(edge => edge.source === payload.source && edge.target === payload.target && edge.relation === payload.relation)) throw legacyError('相同关系已经存在。', 409, 'EDGE_ALREADY_EXISTS'); const next = { ...current, discussionEdges: [...current.discussionEdges, { id: id(), source: payload.source, target: payload.target, relation: payload.relation, label: payload.label || '', createdAt: now() }] }; return { next, value: undefined }; });
        case 'RemoveRelation': return mutateWorkspace(current => { const edge = current.discussionEdges.find(item => item.id === payload.edgeId); if (!edge) throw legacyError('关系不存在。', 404, 'EDGE_NOT_FOUND'); if (current.discussionNodes.some(node => (node.id === edge.source || node.id === edge.target) && node.status === 'archived')) throw legacyError('归档节点及其关系为只读；请先恢复。', 409, 'NODE_ARCHIVED_READ_ONLY'); const next = { ...current, discussionEdges: current.discussionEdges.filter(item => item.id !== edge.id) }; return { next, value: undefined }; });
        case 'CreateMergeRevision': return mutateWorkspace(current => { const result = mergeRevision(current, payload.sourceNodeId, payload.targetNodeId || current.discussionNodes.find(node => node.id === payload.sourceNodeId)?.sourceNodeId || '', payload.summary, id, now, planner); return { next: result.next, value: undefined }; });
        case 'PurgeObject': { const receiptId = id(); const committed = await unitOfWork.execute({ policy: { kind: 'purge', nodeId: payload.nodeId, auditReceiptId: receiptId }, apply: currentPurge(payload.nodeId, payload.confirmation, payload.reason, receiptId, now) }); return { workspace: committed.workspace, purgeReceipt: committed.value.purgeReceipt }; }
        case 'CreateBranch': return mutateWorkspace(current => { const result = createBranch(current, payload, id, now, planner); return { next: result.next, value: undefined }; });
        case 'ExecuteTemporaryConversation': return temporaryConversation(payload, unitOfWork, runtime, activeModel, id, now);
        default: throw new Error('Unhandled application command');
      }
    } catch (error) { throw asApplicationError(error); }
  };

  const dispatchQuery = async (envelope: AnyQueryEnvelope): Promise<unknown> => {
    try {
      if (envelope.queryType === 'ListWorkspaces') return workspaceDirectory.list(envelope.actor, Boolean((envelope.payload as { includeArchived?: boolean }).includeArchived));
      await workspaceDirectory.require(envelope.actor, envelope.workspaceId, envelope.scope);
      if (unitOfWork.withWorkspace) return unitOfWork.withWorkspace(envelope.workspaceId, () => dispatchQueryScoped(envelope));
      return dispatchQueryScoped(envelope);
    } catch (error) { throw asApplicationError(error); }
  };
  const dispatchQueryScoped = async (envelope: AnyQueryEnvelope): Promise<unknown> => {
    try {
      switch (envelope.queryType) {
        case 'GetHealth': return { ok: true };
        case 'GetWorkspace': return unitOfWork.read(workspace => workspace);
        case 'GetProviders': return providers.snapshot();
        case 'GetProviderStatus': {
          if (runtime.kind !== 'librechat') return providers.activeStatus();
          const model = await activeModel();
          return { configured: true, name: model.provider, model: model.displayName, baseUrl: '' };
        }
        case 'ListModels': return (await runtime.listModels()).map(model => ({ id: model.id, provider: model.provider, displayName: model.displayName, active: model.active }));
        default: throw new Error('Unhandled application query');
      }
    } catch (error) { throw asApplicationError(error); }
  };
  return {
    execute: <K extends CommandType>(envelope: CommandEnvelope<K>, options?: CommandExecutionOptions) => dispatch(envelope as AnyCommandEnvelope, options) as Promise<CommandResult<K>>,
    query: <K extends QueryType>(envelope: QueryEnvelope<K>) => dispatchQuery(envelope as AnyQueryEnvelope) as Promise<QueryResult<K>>,
  };
}

function changeNodeStatus(current: WorkspaceData, nodeId: string, status: 'draft' | 'active' | 'resolved' | 'stale' | 'archived', now: () => string, planner: ContextPlannerPort) {
  const node = current.discussionNodes.find(item => item.id === nodeId); if (!node) throw legacyError('讨论节点不存在。', 404, 'NODE_NOT_FOUND');
  if (!nodeStatuses.has(status)) throw legacyError('无效的节点状态。', 400, 'INVALID_NODE_STATUS');
  if (node.status === 'archived' && status !== 'archived' && status !== 'active') throw legacyError('归档节点为只读；请先恢复。', 409, 'NODE_ARCHIVED_READ_ONLY');
  if (status === 'archived' && node.status !== 'archived' && current.discussionNodes.filter(item => item.status !== 'archived').length <= 1) throw legacyError('至少需要保留一个未归档节点。', 409, 'CANNOT_ARCHIVE_LAST_NODE');
  const nodes = current.discussionNodes.map(item => item.id === node.id ? { ...item, status, updatedAt: now() } : item);
  const next = status === 'archived' && current.activeNodeId === node.id ? withCurrentNodeContext({ ...current, discussionNodes: nodes, activeNodeId: nodes.find(item => item.status !== 'archived')!.id, nodeId: nodes.find(item => item.status !== 'archived')!.id }, nodes.find(item => item.status !== 'archived')!.id, planner) : { ...current, discussionNodes: nodes };
  return { next, value: next };
}

function createBranch(current: WorkspaceData, payload: Extract<CommandEnvelope<'CreateBranch'>['payload'], object>, id: () => string, now: () => string, planner: ContextPlannerPort) {
  const source = current.discussionNodes.find(node => node.id === current.activeNodeId); if (!source) throw legacyError('当前讨论节点不存在。', 404, 'NODE_NOT_FOUND');
  const sourceMessage = payload.sourceMessageId ? current.messages.find(message => message.id === payload.sourceMessageId && message.nodeId === source.id) : undefined; if (payload.sourceMessageId && !sourceMessage) throw legacyError('支线来源消息不属于当前讨论。', 400, 'INVALID_BRANCH_SOURCE');
  const createdAt = now(); const nodeId = id(); const anchorText = payload.anchorText || '';
  const requestedExact = sourceMessage && anchorText && Number.isInteger(payload.anchorStart) && Number.isInteger(payload.anchorEnd)
    && payload.anchorStart! >= 0 && payload.anchorEnd! >= payload.anchorStart! && sourceMessage.text.slice(payload.anchorStart, payload.anchorEnd).trim() === anchorText;
  const start = sourceMessage && anchorText ? requestedExact ? payload.anchorStart! : sourceMessage.text.indexOf(anchorText) : 0;
  if (sourceMessage && anchorText && start < 0) throw legacyError('选中文本无法在来源消息中定位。', 400, 'INVALID_ANCHOR_RANGE');
  const anchor = sourceMessage ? { id: id(), nodeId: source.id, messageId: sourceMessage.id, segmentId: sourceMessage.segmentId, selectedText: anchorText || sourceMessage.text, startOffset: start, endOffset: start + (anchorText || sourceMessage.text).length, createdAt } : undefined;
  const node = { id: nodeId, title: payload.title, summary: anchorText || `从「${source.title}」派生的正式支线。`, status: 'active' as const, kind: 'branch' as const, sourceNodeId: source.id, sourceMessageId: payload.sourceMessageId, anchorText, x: Math.min(source.x + 220, 780), y: Math.min(source.y + 105, 360), createdAt, updatedAt: createdAt };
  const edge = { id: id(), source: source.id, target: nodeId, relation: 'derived-from' as const, anchorId: anchor?.id, label: anchorText ? '从内容锚点派生' : '正式支线', createdAt };
  const messages = (payload.messages || []).map(message => ({ id: id(), nodeId, kind: message.kind, text: message.text.trim(), createdAt: message.createdAt || createdAt }));
  const next = withCurrentNodeContext({ ...current, activeNodeId: nodeId, nodeId, messages: [...current.messages, ...messages], anchors: anchor ? [...current.anchors, anchor] : current.anchors, discussionNodes: [...current.discussionNodes.map(item => item.id === source.id ? { ...item, status: 'active' as const, updatedAt: createdAt } : item), node], discussionEdges: [...current.discussionEdges, edge] }, nodeId, planner); return { next, value: next };
}

function mergeRevision(current: WorkspaceData, sourceId: string, targetId: string, summary: string | undefined, id: () => string, now: () => string, planner: ContextPlannerPort) {
  const source = current.discussionNodes.find(node => node.id === sourceId); if (!source || source.kind !== 'branch') throw legacyError('只有正式支线可以合并。', 400, 'INVALID_MERGE_SOURCE');
  const target = current.discussionNodes.find(node => node.id === targetId); if (!target) throw legacyError('合并目标不存在。', 404, 'MERGE_TARGET_NOT_FOUND');
  if (source.status === 'archived' || target.status === 'archived') throw legacyError('归档节点为只读；请先恢复。', 409, 'NODE_ARCHIVED_READ_ONLY'); if (source.status === 'resolved') throw legacyError('该支线已经合并。', 409, 'BRANCH_ALREADY_MERGED');
  const createdAt = now(); const content = summary || [...current.messages].reverse().find(message => message.nodeId === source.id && message.kind === 'assistant')?.text || source.summary;
  const next = withCurrentNodeContext({ ...current, activeNodeId: target.id, nodeId: target.id, messages: [...current.messages, { id: id(), nodeId: target.id, kind: 'assistant' as const, text: `已从支线「${source.title}」合并引用：\n\n${content}`, createdAt }], discussionNodes: current.discussionNodes.map(node => node.id === source.id ? { ...node, status: 'resolved' as const, updatedAt: createdAt } : node), discussionEdges: [...current.discussionEdges, { id: id(), source: source.id, target: target.id, relation: 'merged-into' as const, label: '选择性合并', createdAt }] }, target.id, planner); return { next, value: next };
}

async function temporaryConversation(payload: Extract<CommandEnvelope<'ExecuteTemporaryConversation'>['payload'], object>, uow: WorkspaceUnitOfWork, runtime: RuntimePort, activeModel: () => Promise<Awaited<ReturnType<RuntimePort['listModels']>>[number]>, id: () => string, now: () => string) {
  const current = await uow.read(workspace => workspace); if (!current.discussionNodes.some(node => node.id === payload.sourceNodeId)) throw legacyError('来源讨论节点不存在。', 404, 'NODE_NOT_FOUND');
  const temporaryNodeId = `temp:${payload.sourceNodeId}`; const createdAt = now(); const history = [...current.messages.filter(message => message.nodeId === payload.sourceNodeId).slice(-8), ...(payload.history || []).map(item => ({ id: id(), nodeId: temporaryNodeId, kind: item.kind, text: item.text, createdAt: item.createdAt || createdAt }))]; const model = await activeModel();
  let completion: Completion | undefined;
  for await (const event of runtime.generate({ requestId: id(), manifestId: `temporary:${id()}`, projectId: current.projectId, nodeId: temporaryNodeId, modelId: model.id, prompt: `围绕下列选中内容回答临时支线问题。不要偏离锚点：\n\n「${payload.anchorText}」\n\n问题：${payload.prompt}`, history, contextItems: current.contextItems.filter(item => item.status === 'active'), mode: current.mode })) { if (event.type === 'RUN_ERROR') throw runtimeError(event.message, event.status, event.code); if (event.type === 'RUN_END') completion = event; }
  if (!completion) throw legacyError('AI Runtime 未返回 RUN_END 事件。', 502, 'INCOMPLETE_RUNTIME_STREAM');
  return { userMessage: { id: id(), nodeId: temporaryNodeId, kind: 'user' as const, text: payload.prompt, createdAt }, assistantMessage: { id: id(), nodeId: temporaryNodeId, kind: 'assistant' as const, text: completion.text, createdAt }, model: completion.model };
}

function currentPurge(nodeId: string, confirmation: string, reason: string, receiptId: string, now: () => string) {
  if (confirmation !== `PURGE ${nodeId}`) throw legacyError(`请输入 PURGE ${nodeId} 以确认物理删除。`, 400, 'PURGE_CONFIRMATION_REQUIRED'); if (!reason || reason.length > 500) throw legacyError('Purge 必须提供不超过 500 字符的审计原因。', 400, 'PURGE_REASON_REQUIRED');
  return (current: WorkspaceData) => {
    const node = current.discussionNodes.find(item => item.id === nodeId);
    if (!node) throw legacyError('讨论节点不存在。', 404, 'NODE_NOT_FOUND');
    if (node.status !== 'archived') throw legacyError('仅允许 Purge 已归档节点。', 409, 'PURGE_REQUIRES_ARCHIVED');
    if (current.discussionNodes.some(item => item.sourceNodeId === node.id)) throw legacyError('该节点仍有子支线，不能 Purge。', 409, 'PURGE_NODE_HAS_CHILDREN');
    const messageIds = new Set(current.messages.filter(message => message.nodeId === node.id).map(message => message.id));
    const segmentIds = new Set(current.segments.filter(segment => segment.nodeId === node.id).map(segment => segment.id));
    const manifestIds = new Set(current.manifests.filter(manifest => manifest.nodeId === node.id).map(manifest => manifest.id));
    const anchorIds = new Set(current.anchors.filter(anchor => anchor.nodeId === node.id || (anchor.messageId && messageIds.has(anchor.messageId)) || (anchor.segmentId && segmentIds.has(anchor.segmentId))).map(anchor => anchor.id));
    const fallback = current.discussionNodes.find(item => item.id !== node.id && item.status !== 'archived');
    if (!fallback) throw legacyError('至少需要保留一个未归档节点。', 409, 'CANNOT_PURGE_LAST_NODE');
    const receipt: AuditEvent = { id: receiptId, projectId: current.projectId, nodeId, action: 'node.purged', entityType: 'node', entityId: nodeId, metadata: { reason, confirmation: 'explicit-id-phrase', removed: { nodes: 1, messages: messageIds.size, segments: segmentIds.size, manifests: manifestIds.size, anchors: anchorIds.size } }, createdAt: now() };
    const workspace = {
      ...current, activeNodeId: current.activeNodeId === node.id ? fallback.id : current.activeNodeId, nodeId: current.nodeId === node.id ? fallback.id : current.nodeId,
      discussionNodes: current.discussionNodes.filter(item => item.id !== node.id),
      contextItems: current.contextItems.filter(item => item.sourceNodeId !== node.id && !(item.sourceType === 'node' && item.sourceId === node.id) && !(item.sourceType === 'segment' && item.sourceId && segmentIds.has(item.sourceId))),
      messages: current.messages.filter(message => message.nodeId !== node.id).map(message => ({ ...message, sourceMessageId: message.sourceMessageId && messageIds.has(message.sourceMessageId) ? undefined : message.sourceMessageId, replyToMessageId: message.replyToMessageId && messageIds.has(message.replyToMessageId) ? undefined : message.replyToMessageId })),
      segments: current.segments.filter(segment => segment.nodeId !== node.id), manifests: current.manifests.filter(manifest => !manifestIds.has(manifest.id)), anchors: current.anchors.filter(anchor => !anchorIds.has(anchor.id)),
      discussionEdges: current.discussionEdges.filter(edge => edge.source !== node.id && edge.target !== node.id && (!edge.anchorId || !anchorIds.has(edge.anchorId))), auditEvents: [...current.auditEvents, receipt],
    };
    return { next: workspace, value: { purgeReceipt: receipt } };
  };
}
