import express from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ProviderError } from './ai-provider';
import { collectRuntimeResult, RuntimeExecutionError, type AIRuntime, type ModelInfo, type RuntimeRequest, type RuntimeResult } from './ai-runtime';
import type { ChatOperation, ContextItem, ContextManifest, ContextMode, ContextStatus, GenerationOptions, StoredMessage, WorkspaceData } from './domain';
import { attachmentContextItem, chunkText, estimateTokens, extractPdfText, planContext, summarizeChunks } from './context-planner';
import { loadFeatureFlags, type FeatureFlags } from './feature-flags';
import { providerPresets, type ProviderService } from './provider-service';
import { ProviderRuntime } from './provider-runtime';
import type { WorkspaceRepository } from './store';

const contextStatuses = new Set<ContextStatus>(['active', 'recommended', 'excluded']);
const contextModes = new Set<ContextMode>(['Auto', 'Assisted', 'Strict']);
const edgeRelations = new Set(['derived-from', 'references', 'related-to', 'merged-into']);
const chatOperations = new Set<ChatOperation>(['send', 'retry', 'regenerate', 'edit-resend']);
const textMimeTypes = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/xml', 'text/xml', 'application/javascript', 'text/javascript']);
export const CONTEXT_TOKEN_BUDGET = 32_000;

interface DraftMessageInput {
  kind: 'user' | 'assistant';
  text: string;
  createdAt?: string;
}

function isDraftMessage(value: unknown): value is DraftMessageInput {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<DraftMessageInput>;
  return Boolean(message.kind && ['user', 'assistant'].includes(message.kind) && typeof message.text === 'string' && message.text.trim() && message.text.length <= 20_000);
}

export function createApp(store: WorkspaceRepository, provider: ProviderService, serveFrontend = false, runtime: AIRuntime = new ProviderRuntime(provider), featureFlags: FeatureFlags = loadFeatureFlags(), uploadDirectory = resolve('var/uploads')) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32mb' }));

  const activeRuntimeModel = async (): Promise<ModelInfo> => {
    const model = (await runtime.listModels()).find(item => item.active);
    if (!model) throw new ProviderError('请先在模型设置中选择一个模型。', 503, 'MODEL_NOT_SELECTED');
    return model;
  };

  const activeRuntimeStatus = async () => {
    if (runtime.kind !== 'librechat') return provider.activeStatus();
    const model = await activeRuntimeModel();
    return { configured: true, name: model.provider, model: model.displayName, baseUrl: '' };
  };

  const sourceContextItem = (workspace: WorkspaceData, sourceType: 'node' | 'segment' | 'file', sourceId: string, status: ContextStatus = 'active'): ContextItem => {
    if (sourceType === 'file') {
      const attachment = workspace.attachments.find(item => item.id === sourceId);
      if (!attachment) throw new ProviderError('Context 来源文件不存在。', 404, 'CONTEXT_SOURCE_NOT_FOUND');
      return { ...attachmentContextItem(attachment), status };
    }
    if (sourceType === 'node') {
      const node = workspace.discussionNodes.find(item => item.id === sourceId);
      if (!node) throw new ProviderError('Context 来源节点不存在。', 404, 'CONTEXT_SOURCE_NOT_FOUND');
      const body = workspace.messages.filter(message => message.nodeId === node.id).map(message => message.text).join('\n');
      return { id: randomUUID(), title: node.title, detail: `讨论节点 · ${node.summary}`, role: 'Reference', status, tokens: estimateTokens(`${node.summary}\n${body}`), selectionMode: 'USER_SELECTED', sourceType, sourceId: node.id, sourceNodeId: node.id, pinned: false, contentVersion: 1, reason: '由用户显式加入的讨论节点。' };
    }
    const segment = workspace.segments.find(item => item.id === sourceId);
    if (!segment) throw new ProviderError('Context 来源片段不存在。', 404, 'CONTEXT_SOURCE_NOT_FOUND');
    const node = workspace.discussionNodes.find(item => item.id === segment.nodeId);
    const body = workspace.messages.filter(message => message.segmentId === segment.id).map(message => message.text).join('\n');
    return { id: randomUUID(), title: segment.title, detail: `片段 · 来自 ${node?.title || '未知节点'}`, role: 'Reference', status, tokens: estimateTokens(body || segment.title), selectionMode: 'USER_SELECTED', sourceType, sourceId: segment.id, sourceNodeId: segment.nodeId, pinned: false, contentVersion: 1, reason: '由用户显式加入的讨论片段。' };
  };

  const withCurrentNodeContext = (workspace: WorkspaceData, nodeId: string): WorkspaceData => {
    const existing = workspace.contextItems.find(item => item.sourceType === 'node' && item.sourceId === nodeId);
    const contextItems = workspace.contextItems.map(item => item.selectionMode === 'CURRENT' && item.sourceId !== nodeId
      ? { ...item, selectionMode: 'USER_SELECTED' as const, status: item.pinned ? item.status : 'recommended' as const, reason: item.pinned ? item.reason : '已离开该节点，可按需重新加入。' }
      : item);
    if (existing) return { ...workspace, contextItems: contextItems.map(item => item.id === existing.id ? { ...item, status: 'active' as const, selectionMode: 'CURRENT' as const, reason: '当前讨论节点始终进入本轮上下文。' } : item) };
    const item = sourceContextItem(workspace, 'node', nodeId);
    return { ...workspace, contextItems: [...contextItems, { ...item, selectionMode: 'CURRENT', reason: '当前讨论节点始终进入本轮上下文。' }] };
  };

  const prepareChatRun = async (input: { prompt: string; operation: ChatOperation; sourceMessageId?: string; attachmentIds: string[]; generation: GenerationOptions }): Promise<{ manifest: ContextManifest; request: RuntimeRequest; createdAt: string; userMessageId: string; versionGroupId: string; version: number }> => {
    const current = await store.read();
    const activeNodeId = current.activeNodeId;
    const activeNode = current.discussionNodes.find(node => node.id === activeNodeId);
    if (!activeNode) throw new ProviderError('当前讨论节点不存在。', 404, 'NODE_NOT_FOUND');
    let planner;
    try {
      planner = planContext(current, input.prompt, input.attachmentIds, CONTEXT_TOKEN_BUDGET);
    } catch (error) {
      console.error('[planner] degraded to explicit context', error instanceof Error ? error.message : error);
      const items = current.contextItems.filter(item => item.status === 'active');
      planner = { items, diagnostics: { candidateCount: 0, selectedCount: items.length, elapsedMs: 0, fallback: true, budget: CONTEXT_TOKEN_BUDGET, usedTokens: items.reduce((sum, item) => sum + item.tokens, 0) } };
    }
    const activeContext = planner.items;
    if (activeNode.status === 'archived') throw new ProviderError('归档节点为只读，请先恢复后再继续讨论。', 409, 'NODE_ARCHIVED');
    const createdAt = new Date().toISOString();
    const manifestId = randomUUID();
    const requestId = randomUUID();
    const userMessageId = randomUUID();
    const model = await activeRuntimeModel();
    const source = input.sourceMessageId ? current.messages.find(message => message.id === input.sourceMessageId && message.nodeId === activeNodeId) : undefined;
    if (input.sourceMessageId && !source) throw new ProviderError('版本来源消息不存在或不属于当前讨论。', 400, 'INVALID_MESSAGE_SOURCE');
    if (input.operation === 'edit-resend' && source?.kind !== 'user') throw new ProviderError('Edit & Resend 的来源必须是用户消息。', 400, 'INVALID_EDIT_SOURCE');
    if (input.operation === 'regenerate' && source?.kind !== 'assistant') throw new ProviderError('Regenerate 的来源必须是 AI 消息。', 400, 'INVALID_REGENERATE_SOURCE');
    let prompt = input.prompt;
    let history = current.messages.filter(message => message.nodeId === activeNodeId);
    let versionSource = source;
    if (input.operation === 'regenerate' && source) {
      const sourceIndex = history.findIndex(message => message.id === source.id);
      const priorUser = source.replyToMessageId
        ? history.find(message => message.id === source.replyToMessageId)
        : [...history.slice(0, sourceIndex)].reverse().find(message => message.kind === 'user');
      if (!priorUser) throw new ProviderError('无法找到 Regenerate 对应的用户消息。', 409, 'REGENERATE_PROMPT_MISSING');
      prompt = priorUser.text;
      versionSource = priorUser;
      history = history.slice(0, history.findIndex(message => message.id === priorUser.id));
    } else if (input.operation === 'edit-resend' && source) {
      history = history.slice(0, history.findIndex(message => message.id === source.id));
    }
    const versionGroupId = versionSource?.versionGroupId || versionSource?.id || userMessageId;
    const version = Math.max(0, ...current.messages.filter(message => message.versionGroupId === versionGroupId).map(message => message.version || 1)) + (versionSource ? 1 : 1);
    const attachments = input.attachmentIds.map(id => current.attachments.find(item => item.id === id));
    if (attachments.some(item => !item)) throw new ProviderError('存在无效附件，请重新选择文件。', 400, 'ATTACHMENT_NOT_FOUND');
    const manifest: ContextManifest = {
      id: manifestId,
      projectId: current.projectId,
      nodeId: activeNodeId,
      requestId,
      createdAt,
      mode: current.mode,
      model: model.model,
      provider: model.provider,
      runtime: runtime.kind || 'provider-adapter',
      contextItemIds: current.contextItems.filter(item => item.status === 'active').map(item => item.id),
      excludedItemIds: current.contextItems.filter(item => item.status === 'excluded').map(item => item.id),
      contextItems: activeContext.map(item => ({
        sourceType: item.sourceType || 'reference', sourceId: item.sourceId || item.id, sourceNodeId: item.sourceNodeId,
        title: item.title, detail: item.detail, role: item.role, selectionMode: item.selectionMode || 'CURRENT',
        pinned: Boolean(item.pinned), reason: item.reason || (item.selectionMode === 'CURRENT' ? '当前讨论节点。' : '已加入 Active Context。'),
        tokenCount: item.tokens, contentVersion: item.contentVersion || 1,
      })),
      estimatedTokens: activeContext.reduce((sum, item) => sum + item.tokens, 0),
      generation: input.generation,
      operation: input.operation,
      sourceMessageId: input.sourceMessageId,
      attachmentIds: input.attachmentIds,
      planner: planner.diagnostics,
    };
    return {
      manifest,
      createdAt,
      userMessageId,
      versionGroupId,
      version,
      request: {
        requestId, manifestId, projectId: current.projectId, nodeId: activeNodeId, modelId: model.id,
        prompt, history, contextItems: activeContext, mode: current.mode, attachments: attachments.filter((item): item is NonNullable<typeof item> => Boolean(item)), generation: input.generation,
        operation: input.operation, sourceMessageId: input.sourceMessageId,
      },
    };
  };

  const commitChatRun = async (run: { manifest: ContextManifest; request: RuntimeRequest; createdAt: string; userMessageId: string; versionGroupId: string; version: number }, completion: RuntimeResult) => {
    const operation = run.request.operation || 'send';
    const userMessage: StoredMessage = { id: run.userMessageId, nodeId: run.request.nodeId, kind: 'user', text: run.request.prompt, createdAt: run.createdAt, attachmentIds: run.manifest.attachmentIds, operation, sourceMessageId: run.request.sourceMessageId, versionGroupId: run.versionGroupId, version: run.version };
    const assistantMessage: StoredMessage = { id: randomUUID(), nodeId: run.request.nodeId, kind: 'assistant', text: completion.text, createdAt: run.createdAt, manifestId: run.manifest.id, operation, sourceMessageId: operation === 'regenerate' ? run.request.sourceMessageId : undefined, versionGroupId: run.versionGroupId, version: run.version, replyToMessageId: userMessage.id, usage: completion.usage, reasoning: completion.reasoning, toolCalls: completion.toolCalls };
    await store.update(latest => {
      if (latest.manifests.some(manifest => manifest.requestId === run.request.requestId)) return latest;
      const targetNode = latest.discussionNodes.find(node => node.id === run.request.nodeId);
      if (!targetNode) throw new ProviderError('生成期间讨论节点已被删除，结果未写入。', 409, 'NODE_REMOVED_DURING_RUN');
      if (targetNode.status === 'archived') throw new ProviderError('生成期间讨论节点已归档，结果未写入。', 409, 'NODE_ARCHIVED_DURING_RUN');
      return { ...latest, messages: [...latest.messages, userMessage, assistantMessage], manifests: [...latest.manifests, run.manifest] };
    });
    return { userMessage, assistantMessage, manifest: run.manifest };
  };

  const writeSse = (response: express.Response, event: string, payload: unknown) => {
    response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  const parseChatInput = (body: unknown) => {
    const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const prompt = typeof input.message === 'string' ? input.message.trim() : '';
    const operation = chatOperations.has(input.operation as ChatOperation) ? input.operation as ChatOperation : 'send';
    const sourceMessageId = typeof input.sourceMessageId === 'string' ? input.sourceMessageId : undefined;
    const attachmentIds = Array.isArray(input.attachmentIds) ? [...new Set(input.attachmentIds.filter((id): id is string => typeof id === 'string'))].slice(0, 10) : [];
    const rawGeneration = input.generation && typeof input.generation === 'object' ? input.generation as Partial<GenerationOptions> : {};
    const generation = {
      temperature: Number(rawGeneration.temperature ?? 0.4),
      topP: Number(rawGeneration.topP ?? 1),
      maxTokens: Number(rawGeneration.maxTokens ?? 2048),
    };
    if (!prompt || prompt.length > 20_000) throw new ProviderError('消息不能为空且不能超过 20,000 字符。', 400, 'INVALID_MESSAGE');
    if (!Number.isFinite(generation.temperature) || generation.temperature < 0 || generation.temperature > 2 || !Number.isFinite(generation.topP) || generation.topP <= 0 || generation.topP > 1 || !Number.isInteger(generation.maxTokens) || generation.maxTokens < 1 || generation.maxTokens > 32_768) throw new ProviderError('生成参数超出允许范围。', 400, 'INVALID_GENERATION_OPTIONS');
    return { prompt, operation, sourceMessageId, attachmentIds, generation };
  };

  app.use((request, response, next) => {
    const requestId = randomUUID();
    response.setHeader('X-Request-Id', requestId);
    const startedAt = Date.now();
    response.on('finish', () => {
      console.info(`[api] ${request.method} ${request.path} ${response.statusCode} ${Date.now() - startedAt}ms request=${requestId}`);
    });
    next();
  });

  app.get('/api/health', async (_request, response, next) => {
    try { response.json({ ok: true, provider: await activeRuntimeStatus(), runtime: runtime.kind || 'provider-adapter', featureFlags }); } catch (error) { next(error); }
  });

  app.get('/api/workspace', async (_request, response, next) => {
    try { response.json({ workspace: await store.read(), provider: await activeRuntimeStatus(), providerCatalog: await provider.snapshot() }); } catch (error) { next(error); }
  });

  app.get('/api/providers', async (_request, response, next) => {
    try { response.json({ catalog: await provider.snapshot(), presets: providerPresets }); } catch (error) { next(error); }
  });

  app.post('/api/providers', async (request, response, next) => {
    try { response.status(201).json({ catalog: await provider.saveProvider(request.body) }); } catch (error) { next(error); }
  });

  app.post('/api/attachments', async (request, response, next) => {
    try {
      const name = typeof request.body?.name === 'string' ? request.body.name.trim().slice(0, 240) : '';
      const mimeType = typeof request.body?.mimeType === 'string' ? request.body.mimeType.toLowerCase().slice(0, 120) : 'application/octet-stream';
      const encoded = typeof request.body?.dataBase64 === 'string' ? request.body.dataBase64 : '';
      if (!name || !encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return response.status(400).json({ error: { code: 'INVALID_ATTACHMENT', message: '附件名称或内容无效。' } });
      const filePolicy = (await provider.snapshot()).filePolicy;
      const bytes = Buffer.from(encoded, 'base64');
      if (!bytes.length || bytes.length > filePolicy.maxFileSizeBytes) return response.status(413).json({ error: { code: 'ATTACHMENT_TOO_LARGE', message: `附件大小必须在 1 字节到 ${filePolicy.maxFileSizeBytes} 字节之间。` } });
      if (filePolicy.supportedMimeTypes.length && !filePolicy.supportedMimeTypes.includes(mimeType)) return response.status(415).json({ error: { code: 'UNSUPPORTED_ATTACHMENT', message: `当前模型不支持 ${mimeType}。` } });
      const id = randomUUID();
      await mkdir(uploadDirectory, { recursive: true });
      await writeFile(resolve(uploadDirectory, id), bytes);
      const indexable = textMimeTypes.has(mimeType) || mimeType.startsWith('text/') || mimeType === 'application/pdf';
      const extracted = mimeType === 'application/pdf' ? extractPdfText(bytes) : indexable ? bytes.toString('utf8') : '';
      const chunks = extracted ? chunkText(id, extracted) : [];
      const summary = summarizeChunks(name, chunks);
      const attachment = { id, name, mimeType, size: bytes.length, kind: mimeType.startsWith('image/') ? 'image' as const : 'file' as const, summary, chunkCount: chunks.length, ...(extracted && bytes.length <= 100_000 ? { extractedText: extracted } : {}), createdAt: new Date().toISOString() };
      await store.update(current => ({ ...current, attachments: [...current.attachments, attachment], fileChunks: [...current.fileChunks, ...chunks] }));
      const safeAttachment = { id: attachment.id, name: attachment.name, mimeType: attachment.mimeType, size: attachment.size, kind: attachment.kind, summary: attachment.summary, chunkCount: attachment.chunkCount, createdAt: attachment.createdAt };
      response.status(201).json({ attachment: safeAttachment });
    } catch (error) { next(error); }
  });

  app.put('/api/providers/:id', async (request, response, next) => {
    try { response.json({ catalog: await provider.saveProvider(request.body, request.params.id) }); } catch (error) { next(error); }
  });

  app.post('/api/providers/:id/discover', async (request, response, next) => {
    try { response.json({ catalog: await provider.discoverModels(request.params.id) }); } catch (error) { next(error); }
  });

  app.patch('/api/models/:id', async (request, response, next) => {
    try { response.json({ catalog: await provider.updateModel(request.params.id, request.body || {}) }); } catch (error) { next(error); }
  });

  app.post('/api/models/:id/select', async (request, response, next) => {
    try { response.json({ catalog: await provider.selectModel(request.params.id), provider: await activeRuntimeStatus() }); } catch (error) { next(error); }
  });

  app.patch('/api/workspace/mode', async (request, response, next) => {
    try {
      const mode = request.body?.mode as ContextMode;
      if (!contextModes.has(mode)) return response.status(400).json({ error: { code: 'INVALID_MODE', message: '无效的 Context 模式。' } });
      const workspace = await store.update(current => ({ ...current, mode }));
      response.json({ workspace });
    } catch (error) { next(error); }
  });

  app.patch('/api/workspace/context/:id', async (request, response, next) => {
    try {
      const status = request.body?.status as ContextStatus | undefined;
      const pinned = request.body?.pinned as boolean | undefined;
      if (status !== undefined && !contextStatuses.has(status)) return response.status(400).json({ error: { code: 'INVALID_STATUS', message: '无效的 Context 状态。' } });
      if (pinned !== undefined && typeof pinned !== 'boolean') return response.status(400).json({ error: { code: 'INVALID_PIN', message: '无效的 Pin 状态。' } });
      if (status === undefined && pinned === undefined) return response.status(400).json({ error: { code: 'EMPTY_CONTEXT_UPDATE', message: '没有可更新的 Context 字段。' } });
      let found = false;
      const workspace = await store.update(current => ({
        ...current,
        contextItems: current.contextItems.map(item => {
          if (item.id !== request.params.id) return item;
          found = true;
          const nextStatus = status || (pinned ? 'active' : item.status);
          return { ...item, status: nextStatus, pinned: pinned ?? item.pinned,
            ...(item.status === 'recommended' && status === 'active' ? { selectionMode: 'AI_RECOMMENDED_ACCEPTED' as const } : {}),
            ...(status === 'excluded' ? { pinned: false, reason: '用户显式排除，本轮不会发送给模型。' } : {}),
          };
        }),
      }));
      if (!found) return response.status(404).json({ error: { code: 'CONTEXT_NOT_FOUND', message: 'Context 条目不存在。' } });
      response.json({ workspace });
    } catch (error) { next(error); }
  });

  app.post('/api/workspace/context', async (request, response, next) => {
    try {
      const sourceType = request.body?.sourceType as 'node' | 'segment' | 'file';
      const sourceId = typeof request.body?.sourceId === 'string' ? request.body.sourceId : '';
      if (!['node', 'segment', 'file'].includes(sourceType) || !sourceId) return response.status(400).json({ error: { code: 'INVALID_CONTEXT_SOURCE', message: '请选择有效的 Node、Segment 或 File。' } });
      const workspace = await store.update(current => {
        const existing = current.contextItems.find(item => item.sourceType === sourceType && item.sourceId === sourceId);
        if (existing) return { ...current, contextItems: current.contextItems.map(item => item.id === existing.id ? { ...item, status: 'active' as const, selectionMode: 'USER_SELECTED' as const, reason: '由用户显式加入。' } : item) };
        return { ...current, contextItems: [...current.contextItems, sourceContextItem(current, sourceType, sourceId)] };
      });
      response.status(201).json({ workspace });
    } catch (error) { next(error); }
  });

  app.post('/api/nodes', async (request, response, next) => {
    try {
      const title = typeof request.body?.title === 'string' ? request.body.title.trim() : '';
      const anchorText = typeof request.body?.anchorText === 'string' ? request.body.anchorText.trim().slice(0, 2000) : '';
      const sourceMessageId = typeof request.body?.sourceMessageId === 'string' ? request.body.sourceMessageId : undefined;
      const requestedStart = Number.isInteger(request.body?.anchorStart) ? Number(request.body.anchorStart) : undefined;
      const requestedEnd = Number.isInteger(request.body?.anchorEnd) ? Number(request.body.anchorEnd) : undefined;
      const draftMessages: unknown[] = Array.isArray(request.body?.messages) ? request.body.messages.slice(0, 40) : [];
      if (!title || title.length > 120) return response.status(400).json({ error: { code: 'INVALID_NODE_TITLE', message: '支线标题不能为空且不能超过 120 字符。' } });
      if (!draftMessages.every(isDraftMessage)) return response.status(400).json({ error: { code: 'INVALID_BRANCH_MESSAGES', message: '临时支线消息格式无效。' } });
      const workspace = await store.update(current => {
        const source = current.discussionNodes.find(node => node.id === current.activeNodeId);
        if (!source) throw new ProviderError('当前讨论节点不存在。', 404, 'NODE_NOT_FOUND');
        const sourceMessage = sourceMessageId ? current.messages.find(message => message.id === sourceMessageId && message.nodeId === source.id) : undefined;
        if (sourceMessageId && !sourceMessage) throw new ProviderError('支线来源消息不属于当前讨论。', 400, 'INVALID_BRANCH_SOURCE');
        let startOffset: number | undefined;
        let endOffset: number | undefined;
        if (sourceMessage && anchorText) {
          const exactOffsets = requestedStart !== undefined && requestedEnd !== undefined && requestedStart >= 0 && requestedEnd >= requestedStart && sourceMessage.text.slice(requestedStart, requestedEnd).trim() === anchorText;
          startOffset = exactOffsets ? requestedStart : sourceMessage.text.indexOf(anchorText);
          if (startOffset < 0) throw new ProviderError('选中文本无法在来源消息中定位。', 400, 'INVALID_ANCHOR_RANGE');
          endOffset = startOffset + anchorText.length;
        }
        const createdAt = new Date().toISOString();
        const id = randomUUID();
        const anchor = sourceMessage ? { id: randomUUID(), nodeId: source.id, messageId: sourceMessage.id, segmentId: sourceMessage.segmentId, selectedText: anchorText || sourceMessage.text, startOffset: startOffset ?? 0, endOffset: endOffset ?? sourceMessage.text.length, createdAt } : undefined;
        const node = { id, title, summary: anchorText || `从「${source.title}」派生的正式支线。`, status: 'active' as const, kind: 'branch' as const, sourceNodeId: source.id, sourceMessageId, anchorText, x: Math.min(source.x + 220, 780), y: Math.min(source.y + 105, 360), createdAt, updatedAt: createdAt };
        const edge = { id: randomUUID(), source: source.id, target: id, relation: 'derived-from' as const, anchorId: anchor?.id, label: anchorText ? '从内容锚点派生' : '正式支线', createdAt };
        const preservedMessages = draftMessages.map(message => ({ id: randomUUID(), nodeId: id, kind: message.kind as 'user' | 'assistant', text: message.text.trim(), createdAt: typeof message.createdAt === 'string' ? message.createdAt : createdAt }));
        return withCurrentNodeContext({ ...current, activeNodeId: id, nodeId: id, messages: [...current.messages, ...preservedMessages], anchors: anchor ? [...current.anchors, anchor] : current.anchors, discussionNodes: [...current.discussionNodes.map(item => item.id === source.id ? { ...item, status: 'active' as const } : item), node], discussionEdges: [...current.discussionEdges, edge] }, id);
      });
      response.status(201).json({ workspace });
    } catch (error) { next(error); }
  });

  app.post('/api/graph/nodes', async (request, response, next) => {
    try {
      const title = typeof request.body?.title === 'string' ? request.body.title.trim() : '';
      const summary = typeof request.body?.summary === 'string' ? request.body.summary.trim().slice(0, 500) : '';
      const x = Number(request.body?.x ?? 180);
      const y = Number(request.body?.y ?? 140);
      if (!title || title.length > 120) return response.status(400).json({ error: { code: 'INVALID_NODE_TITLE', message: '节点标题不能为空且不能超过 120 字符。' } });
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 5000 || y > 5000) return response.status(400).json({ error: { code: 'INVALID_POSITION', message: '节点坐标无效。' } });
      const workspace = await store.update(current => {
        const createdAt = new Date().toISOString();
        const node = { id: randomUUID(), title, summary: summary || '尚未补充讨论摘要。', status: 'draft' as const, kind: 'branch' as const, x: Math.round(x), y: Math.round(y), createdAt, updatedAt: createdAt };
        return { ...current, discussionNodes: [...current.discussionNodes, node] };
      });
      response.status(201).json({ workspace });
    } catch (error) { next(error); }
  });

  app.post('/api/temp-chat', async (request, response, next) => {
    try {
      const sourceNodeId = typeof request.body?.sourceNodeId === 'string' ? request.body.sourceNodeId : '';
      const anchorText = typeof request.body?.anchorText === 'string' ? request.body.anchorText.trim().slice(0, 4000) : '';
      const prompt = typeof request.body?.message === 'string' ? request.body.message.trim() : '';
      const draftHistory: unknown[] = Array.isArray(request.body?.history) ? request.body.history.slice(-20) : [];
      if (!sourceNodeId || !anchorText || !prompt || prompt.length > 20_000) return response.status(400).json({ error: { code: 'INVALID_TEMP_CHAT', message: '临时支线需要来源节点、内容锚点和有效问题。' } });
      if (!draftHistory.every(isDraftMessage)) return response.status(400).json({ error: { code: 'INVALID_TEMP_HISTORY', message: '临时对话历史格式无效。' } });
      const current = await store.read();
      if (!current.discussionNodes.some(node => node.id === sourceNodeId)) return response.status(404).json({ error: { code: 'NODE_NOT_FOUND', message: '来源讨论节点不存在。' } });
      const activeContext = current.contextItems.filter(item => item.status === 'active');
      const sourceHistory = current.messages.filter(message => message.nodeId === sourceNodeId).slice(-8);
      const temporaryNodeId = `temp:${sourceNodeId}`;
      const history = [...sourceHistory, ...draftHistory.map(message => ({ id: randomUUID(), nodeId: temporaryNodeId, kind: message.kind as 'user' | 'assistant', text: message.text, createdAt: new Date().toISOString() }))];
      const model = await activeRuntimeModel();
      const completion = await collectRuntimeResult(runtime, {
        requestId: randomUUID(), manifestId: `temporary:${randomUUID()}`, projectId: current.projectId,
        nodeId: temporaryNodeId, modelId: model.id,
        prompt: `围绕下列选中内容回答临时支线问题。不要偏离锚点：\n\n「${anchorText}」\n\n问题：${prompt}`,
        history, contextItems: activeContext, mode: current.mode,
      });
      const createdAt = new Date().toISOString();
      response.status(201).json({
        userMessage: { id: randomUUID(), nodeId: temporaryNodeId, kind: 'user', text: prompt, createdAt },
        assistantMessage: { id: randomUUID(), nodeId: temporaryNodeId, kind: 'assistant', text: completion.text, createdAt },
        model: completion.model,
      });
    } catch (error) { next(error); }
  });

  app.post('/api/nodes/:id/activate', async (request, response, next) => {
    try {
      const workspace = await store.update(current => {
        const node = current.discussionNodes.find(item => item.id === request.params.id);
        if (!node) throw new ProviderError('讨论节点不存在。', 404, 'NODE_NOT_FOUND');
        if (node.status === 'archived') throw new ProviderError('归档节点不能激活，请先恢复。', 409, 'NODE_ARCHIVED');
        return withCurrentNodeContext({ ...current, activeNodeId: request.params.id, nodeId: request.params.id }, request.params.id);
      });
      response.json({ workspace });
    } catch (error) { next(error); }
  });

  app.patch('/api/nodes/:id/status', async (request, response, next) => {
    try {
      const status = request.body?.status;
      if (!['draft', 'active', 'resolved', 'stale', 'archived'].includes(status)) return response.status(400).json({ error: { code: 'INVALID_NODE_STATUS', message: '无效的节点状态。' } });
      const workspace = await store.update(current => {
        const node = current.discussionNodes.find(item => item.id === request.params.id);
        if (!node) throw new ProviderError('讨论节点不存在。', 404, 'NODE_NOT_FOUND');
        if (node.status === 'archived') {
          if (status === 'archived') return current;
          if (status !== 'active') throw new ProviderError('归档节点为只读；请先恢复。', 409, 'NODE_ARCHIVED_READ_ONLY');
        }
        if (status === 'archived' && current.discussionNodes.filter(item => item.status !== 'archived').length <= 1) throw new ProviderError('至少需要保留一个未归档节点。', 409, 'CANNOT_ARCHIVE_LAST_NODE');
        const updatedAt = new Date().toISOString();
        const nodes = current.discussionNodes.map(item => item.id === node.id ? { ...item, status, updatedAt } : item);
        if (status !== 'archived' || current.activeNodeId !== node.id) return { ...current, discussionNodes: nodes };
        const fallback = nodes.find(item => item.status !== 'archived')!;
        return withCurrentNodeContext({ ...current, discussionNodes: nodes, activeNodeId: fallback.id, nodeId: fallback.id }, fallback.id);
      });
      response.json({ workspace });
    } catch (error) { next(error); }
  });

  app.post('/api/nodes/:id/segments', async (request, response, next) => {
    try {
      const title = typeof request.body?.title === 'string' ? request.body.title.trim() : '';
      const messageIds = Array.isArray(request.body?.messageIds) ? [...new Set(request.body.messageIds.filter((id: unknown): id is string => typeof id === 'string'))] : [];
      if (!title || title.length > 200) return response.status(400).json({ error: { code: 'INVALID_SEGMENT_TITLE', message: 'Segment 标题不能为空且不能超过 200 字符。' } });
      const workspace = await store.update(current => {
        const node = current.discussionNodes.find(item => item.id === request.params.id);
        if (!node) throw new ProviderError('讨论节点不存在。', 404, 'NODE_NOT_FOUND');
        if (node.status === 'archived') throw new ProviderError('归档节点为只读；请先恢复。', 409, 'NODE_ARCHIVED_READ_ONLY');
        if (messageIds.some(id => !current.messages.some(message => message.id === id && message.nodeId === request.params.id))) throw new ProviderError('Segment 只能包含所属节点中的 Event。', 400, 'INVALID_SEGMENT_EVENT');
        const ordinal = Math.max(-1, ...current.segments.filter(segment => segment.nodeId === request.params.id).map(segment => segment.ordinal)) + 1;
        const segment = { id: randomUUID(), nodeId: request.params.id, ordinal, title, createdAt: new Date().toISOString() };
        return { ...current, segments: [...current.segments, segment], messages: current.messages.map(message => messageIds.includes(message.id) ? { ...message, segmentId: segment.id } : message) };
      });
      response.status(201).json({ workspace, segment: workspace.segments.at(-1) });
    } catch (error) { next(error); }
  });

  app.patch('/api/nodes/:id/position', async (request, response, next) => {
    try {
      const x = Number(request.body?.x); const y = Number(request.body?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 5000 || y > 5000) return response.status(400).json({ error: { code: 'INVALID_POSITION', message: '节点坐标无效。' } });
      const workspace = await store.update(current => {
        const node = current.discussionNodes.find(item => item.id === request.params.id);
        if (!node) throw new ProviderError('讨论节点不存在。', 404, 'NODE_NOT_FOUND');
        if (node.status === 'archived') throw new ProviderError('归档节点为只读；请先恢复。', 409, 'NODE_ARCHIVED_READ_ONLY');
        return { ...current, discussionNodes: current.discussionNodes.map(item => item.id === node.id ? { ...item, x: Math.round(x), y: Math.round(y), updatedAt: new Date().toISOString() } : item) };
      });
      response.json({ workspace });
    } catch (error) { next(error); }
  });

  app.delete('/api/graph/nodes/:id', async (request, response, next) => {
    try {
      const workspace = await store.update(current => {
        const node = current.discussionNodes.find(item => item.id === request.params.id);
        if (!node) throw new ProviderError('讨论节点不存在。', 404, 'NODE_NOT_FOUND');
        if (node.status === 'archived') return current;
        if (current.discussionNodes.filter(item => item.status !== 'archived').length <= 1) throw new ProviderError('至少需要保留一个未归档节点。', 409, 'CANNOT_ARCHIVE_LAST_NODE');
        const updatedAt = new Date().toISOString();
        const nodes = current.discussionNodes.map(item => item.id === node.id ? { ...item, status: 'archived' as const, updatedAt } : item);
        if (current.activeNodeId !== node.id) return { ...current, discussionNodes: nodes };
        const fallback = nodes.find(item => item.status !== 'archived')!;
        return withCurrentNodeContext({ ...current, discussionNodes: nodes, activeNodeId: fallback.id, nodeId: fallback.id }, fallback.id);
      });
      response.json({ workspace });
    } catch (error) { next(error); }
  });

  // M01 deliberately keeps physical deletion behind a separate, explicit
  // compatibility seam. Ordinary DELETE above is archive-only; the richer
  // permission/tombstone policy belongs to the later Purge milestone.
  app.post('/api/graph/nodes/:id/purge', async (request, response, next) => {
    try {
      const confirmation = typeof request.body?.confirmation === 'string' ? request.body.confirmation : '';
      const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : '';
      if (confirmation !== `PURGE ${request.params.id}`) {
        return response.status(400).json({ error: { code: 'PURGE_CONFIRMATION_REQUIRED', message: `请输入 PURGE ${request.params.id} 以确认物理删除。` } });
      }
      if (!reason || reason.length > 500) {
        return response.status(400).json({ error: { code: 'PURGE_REASON_REQUIRED', message: 'Purge 必须提供不超过 500 字符的审计原因。' } });
      }

      const receiptId = randomUUID();
      const workspace = await store.update(current => {
        const node = current.discussionNodes.find(item => item.id === request.params.id);
        if (!node) throw new ProviderError('讨论节点不存在。', 404, 'NODE_NOT_FOUND');
        if (node.status !== 'archived') throw new ProviderError('仅允许 Purge 已归档节点。', 409, 'PURGE_REQUIRES_ARCHIVED');
        if (current.discussionNodes.some(item => item.sourceNodeId === node.id)) throw new ProviderError('该节点仍有子支线，不能 Purge。', 409, 'PURGE_NODE_HAS_CHILDREN');

        const messageIds = new Set(current.messages.filter(message => message.nodeId === node.id).map(message => message.id));
        const segmentIds = new Set(current.segments.filter(segment => segment.nodeId === node.id).map(segment => segment.id));
        const manifestIds = new Set(current.manifests.filter(manifest => manifest.nodeId === node.id).map(manifest => manifest.id));
        const anchorIds = new Set(current.anchors.filter(anchor => anchor.nodeId === node.id || (anchor.messageId && messageIds.has(anchor.messageId)) || (anchor.segmentId && segmentIds.has(anchor.segmentId))).map(anchor => anchor.id));
        const createdAt = new Date().toISOString();
        const fallback = current.discussionNodes.find(item => item.id !== node.id && item.status !== 'archived');
        if (!fallback) throw new ProviderError('至少需要保留一个未归档节点。', 409, 'CANNOT_PURGE_LAST_NODE');

        return {
          ...current,
          activeNodeId: current.activeNodeId === node.id ? fallback.id : current.activeNodeId,
          nodeId: current.nodeId === node.id ? fallback.id : current.nodeId,
          discussionNodes: current.discussionNodes.filter(item => item.id !== node.id),
          contextItems: current.contextItems.filter(item => item.sourceNodeId !== node.id
            && !(item.sourceType === 'node' && item.sourceId === node.id)
            && !(item.sourceType === 'segment' && item.sourceId && segmentIds.has(item.sourceId))),
          messages: current.messages.filter(message => message.nodeId !== node.id).map(message => ({
            ...message,
            sourceMessageId: message.sourceMessageId && messageIds.has(message.sourceMessageId) ? undefined : message.sourceMessageId,
            replyToMessageId: message.replyToMessageId && messageIds.has(message.replyToMessageId) ? undefined : message.replyToMessageId,
          })),
          segments: current.segments.filter(segment => segment.nodeId !== node.id),
          manifests: current.manifests.filter(manifest => !manifestIds.has(manifest.id)),
          anchors: current.anchors.filter(anchor => !anchorIds.has(anchor.id)),
          discussionEdges: current.discussionEdges.filter(edge => edge.source !== node.id && edge.target !== node.id && (!edge.anchorId || !anchorIds.has(edge.anchorId))),
          auditEvents: [...current.auditEvents, {
            id: receiptId,
            projectId: current.projectId,
            nodeId: node.id,
            action: 'node.purged',
            entityType: 'node' as const,
            entityId: node.id,
            metadata: {
              reason,
              confirmation: 'explicit-id-phrase',
              removed: { nodes: 1, messages: messageIds.size, segments: segmentIds.size, manifests: manifestIds.size, anchors: anchorIds.size },
            },
            createdAt,
          }],
        };
      }, { purge: { nodeId: request.params.id, auditReceiptId: receiptId } });
      response.json({ workspace, purgeReceipt: workspace.auditEvents.find(event => event.id === receiptId) });
    } catch (error) { next(error); }
  });

  app.post('/api/graph/edges', async (request, response, next) => {
    try {
      const source = typeof request.body?.source === 'string' ? request.body.source : '';
      const target = typeof request.body?.target === 'string' ? request.body.target : '';
      const relation = typeof request.body?.relation === 'string' ? request.body.relation : 'related-to';
      const label = typeof request.body?.label === 'string' ? request.body.label.trim().slice(0, 120) : '';
      if (!source || !target || source === target || !edgeRelations.has(relation)) return response.status(400).json({ error: { code: 'INVALID_EDGE', message: '关系必须连接两个不同的节点，并使用有效关系类型。' } });
      if (!label) return response.status(400).json({ error: { code: 'INVALID_EDGE_LABEL', message: '关系标签不能为空。' } });
      const workspace = await store.update(current => {
        const sourceNode = current.discussionNodes.find(node => node.id === source);
        const targetNode = current.discussionNodes.find(node => node.id === target);
        if (!sourceNode || !targetNode) throw new ProviderError('关系节点不存在。', 404, 'NODE_NOT_FOUND');
        if (sourceNode.status === 'archived' || targetNode.status === 'archived') throw new ProviderError('归档节点为只读；请先恢复。', 409, 'NODE_ARCHIVED_READ_ONLY');
        if (current.discussionEdges.some(edge => edge.source === source && edge.target === target && edge.relation === relation)) throw new ProviderError('相同关系已经存在。', 409, 'EDGE_ALREADY_EXISTS');
        const createdAt = new Date().toISOString();
        const edge = { id: randomUUID(), source, target, relation: relation as 'derived-from' | 'references' | 'related-to' | 'merged-into', label, createdAt };
        return { ...current, discussionEdges: [...current.discussionEdges, edge] };
      });
      response.status(201).json({ workspace });
    } catch (error) { next(error); }
  });

  app.delete('/api/graph/edges/:id', async (request, response, next) => {
    try {
      const workspace = await store.update(current => {
        const edge = current.discussionEdges.find(item => item.id === request.params.id);
        if (!edge) throw new ProviderError('关系不存在。', 404, 'EDGE_NOT_FOUND');
        if (current.discussionNodes.some(node => (node.id === edge.source || node.id === edge.target) && node.status === 'archived')) throw new ProviderError('归档节点及其关系为只读；请先恢复。', 409, 'NODE_ARCHIVED_READ_ONLY');
        return { ...current, discussionEdges: current.discussionEdges.filter(item => item.id !== edge.id) };
      });
      response.json({ workspace });
    } catch (error) { next(error); }
  });

  app.post('/api/nodes/:id/merge', async (request, response, next) => {
    try {
      const workspace = await store.update(current => {
        const source = current.discussionNodes.find(node => node.id === request.params.id);
        if (!source || source.kind !== 'branch') throw new ProviderError('只有正式支线可以合并。', 400, 'INVALID_MERGE_SOURCE');
        if (source.status === 'archived') throw new ProviderError('归档节点为只读；请先恢复。', 409, 'NODE_ARCHIVED_READ_ONLY');
        if (source.status === 'resolved') throw new ProviderError('该支线已经合并。', 409, 'BRANCH_ALREADY_MERGED');
        const targetId = typeof request.body?.targetNodeId === 'string' ? request.body.targetNodeId : source.sourceNodeId;
        const target = current.discussionNodes.find(node => node.id === targetId);
        if (!target) throw new ProviderError('合并目标不存在。', 404, 'MERGE_TARGET_NOT_FOUND');
        if (target.status === 'archived') throw new ProviderError('归档节点为只读；请先恢复。', 409, 'NODE_ARCHIVED_READ_ONLY');
        const lastAnswer = [...current.messages].reverse().find(message => message.nodeId === source.id && message.kind === 'assistant')?.text;
        const summary = typeof request.body?.summary === 'string' && request.body.summary.trim() ? request.body.summary.trim().slice(0, 5000) : lastAnswer || source.summary;
        const createdAt = new Date().toISOString();
        const mergeMessage = { id: randomUUID(), nodeId: target.id, kind: 'assistant' as const, text: `已从支线「${source.title}」合并引用：\n\n${summary}`, createdAt };
        const edge = { id: randomUUID(), source: source.id, target: target.id, relation: 'merged-into' as const, label: '选择性合并', createdAt };
        return withCurrentNodeContext({ ...current, activeNodeId: target.id, nodeId: target.id, messages: [...current.messages, mergeMessage], discussionNodes: current.discussionNodes.map(node => node.id === source.id ? { ...node, status: 'resolved' as const, updatedAt: createdAt } : node), discussionEdges: [...current.discussionEdges, edge] }, target.id);
      });
      response.json({ workspace });
    } catch (error) { next(error); }
  });

  app.post('/api/chat/stream', async (request, response, next) => {
    try {
      const input = parseChatInput(request.body);
      const run = await prepareChatRun(input);
      const controller = new AbortController();
      run.request.signal = controller.signal;
      response.on('close', () => { if (!response.writableEnded) controller.abort(); });
      response.status(200);
      response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      response.setHeader('Cache-Control', 'no-cache, no-transform');
      response.setHeader('Connection', 'keep-alive');
      response.setHeader('X-Accel-Buffering', 'no');
      response.flushHeaders();

      for await (const event of runtime.generate(run.request)) {
        writeSse(response, 'runtime', event);
        if (event.type === 'RUN_ERROR') { response.end(); return; }
        if (event.type === 'RUN_END') {
          const committed = await commitChatRun(run, { text: event.text, model: event.model, provider: event.provider, reasoning: event.reasoning, toolCalls: event.toolCalls, usage: event.usage || { promptTokens: 0, completionTokens: Math.ceil(event.text.length / 4), totalTokens: Math.ceil(event.text.length / 4), estimated: true } });
          writeSse(response, 'commit', { type: 'COMMIT', ...committed });
          response.end();
          return;
        }
      }
      writeSse(response, 'runtime', { type: 'RUN_ERROR', requestId: run.request.requestId, code: 'INCOMPLETE_RUNTIME_STREAM', message: 'AI Runtime 未返回结束事件。', status: 502 });
      response.end();
    } catch (error) {
      if (!response.headersSent) return next(error);
      const runtimeError = error instanceof ProviderError || error instanceof RuntimeExecutionError
        ? error
        : new RuntimeExecutionError(error instanceof Error ? error.message : 'AI Runtime 流式执行失败。');
      writeSse(response, 'runtime', { type: 'RUN_ERROR', requestId: response.getHeader('X-Request-Id'), code: runtimeError.code, message: runtimeError.message, status: runtimeError.status });
      response.end();
    }
  });

  app.post('/api/chat', async (request, response, next) => {
    try {
      const run = await prepareChatRun(parseChatInput(request.body));
      const completion = await collectRuntimeResult(runtime, run.request);
      response.status(201).json(await commitChatRun(run, completion));
    } catch (error) { next(error); }
  });

  if (serveFrontend) {
    const distPath = resolve('dist');
    if (existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*path', (_request, response) => response.sendFile(resolve(distPath, 'index.html')));
    }
  }

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof ProviderError || error instanceof RuntimeExecutionError) return response.status(error.status).json({ error: { code: error.code, message: error.message } });
    console.error('[api] unhandled request error', error instanceof Error ? error.message : error);
    response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '服务器处理请求时发生错误。' } });
  });

  return app;
}
