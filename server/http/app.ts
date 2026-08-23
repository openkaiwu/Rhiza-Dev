import express from 'express';
import { ApplicationError, applicationError } from '../contracts/application-error';
import {
  createLegacyCommandEnvelope,
  createLegacyQueryEnvelope,
  type Application,
  type CommandExecutionOptions,
  type CommandMap,
  type CommandResult,
  type CommandType,
  type QueryMap,
  type QueryResult,
  type QueryType,
} from '../contracts/application';
type ChatOperation = CommandMap['CreateConversationRun']['payload']['operation'];
type ContextMode = CommandMap['ChangeContextMode']['payload']['mode'];
type ContextStatus = NonNullable<CommandMap['ChangeContextSelection']['payload']['status']>;
type GenerationOptions = CommandMap['CreateConversationRun']['payload']['generation'];

const contextStatuses = new Set<ContextStatus>(['active', 'recommended', 'excluded']);
const contextModes = new Set<ContextMode>(['Auto', 'Assisted', 'Strict']);
const edgeRelations = new Set(['derived-from', 'references', 'related-to', 'merged-into'] as const);
const chatOperations = new Set<ChatOperation>(['send', 'retry', 'regenerate', 'edit-resend']);

interface DraftMessageInput {
  kind: 'user' | 'assistant';
  text: string;
  createdAt?: string;
}

export interface HttpAppOptions {
  id(): string;
  runtimeKind: 'provider-adapter' | 'librechat';
  featureFlags: unknown;
  providerPresets: unknown;
  frontendDirectory?: string;
  log?: {
    info(message: string): void;
    error(message: string, error?: unknown): void;
  };
}

function isDraftMessage(value: unknown): value is DraftMessageInput {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<DraftMessageInput>;
  return Boolean(message.kind && ['user', 'assistant'].includes(message.kind)
    && typeof message.text === 'string' && message.text.trim() && message.text.length <= 20_000);
}

function rejectInput(message: string, code: string, status = 400): never {
  throw applicationError(message, code, 'validation', 'none', false, status);
}

function correlationId(response: express.Response): string {
  return String(response.getHeader('X-Request-Id') || '');
}

function parseChatInput(body: unknown): CommandMap['CreateConversationRun']['payload'] {
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const prompt = typeof input.message === 'string' ? input.message.trim() : '';
  const operation = chatOperations.has(input.operation as ChatOperation) ? input.operation as ChatOperation : 'send';
  const sourceMessageId = typeof input.sourceMessageId === 'string' ? input.sourceMessageId : undefined;
  const attachmentIds = Array.isArray(input.attachmentIds)
    ? [...new Set(input.attachmentIds.filter((id): id is string => typeof id === 'string'))].slice(0, 10)
    : [];
  const raw = input.generation && typeof input.generation === 'object' ? input.generation as Partial<GenerationOptions> : {};
  const generation = {
    temperature: Number(raw.temperature ?? 0.4),
    topP: Number(raw.topP ?? 1),
    maxTokens: Number(raw.maxTokens ?? 2048),
  };
  if (!prompt || prompt.length > 20_000) rejectInput('消息不能为空且不能超过 20,000 字符。', 'INVALID_MESSAGE');
  if (!Number.isFinite(generation.temperature) || generation.temperature < 0 || generation.temperature > 2
    || !Number.isFinite(generation.topP) || generation.topP <= 0 || generation.topP > 1
    || !Number.isInteger(generation.maxTokens) || generation.maxTokens < 1 || generation.maxTokens > 32_768) {
    rejectInput('生成参数超出允许范围。', 'INVALID_GENERATION_OPTIONS');
  }
  return { prompt, operation, sourceMessageId, attachmentIds, generation };
}

function writeSse(response: express.Response, event: string, payload: unknown): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export function createHttpApp(application: Application, options: HttpAppOptions): express.Express {
  const app = express();
  const log = options.log ?? console;
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32mb' }));

  const execute = <K extends CommandType>(
    response: express.Response,
    commandType: K,
    payload: CommandMap[K]['payload'],
    executionOptions?: CommandExecutionOptions,
  ): Promise<CommandResult<K>> => application.execute(
    createLegacyCommandEnvelope(options.id(), commandType, payload, correlationId(response)),
    executionOptions,
  );
  const query = <K extends QueryType>(response: express.Response, queryType: K, payload: QueryMap[K]['payload']): Promise<QueryResult<K>> =>
    application.query(createLegacyQueryEnvelope(options.id(), queryType, payload, correlationId(response)));

  app.use((request, response, next) => {
    const requestId = options.id();
    response.setHeader('X-Request-Id', requestId);
    const startedAt = Date.now();
    response.on('finish', () => log.info(`[api] ${request.method} ${request.path} ${response.statusCode} ${Date.now() - startedAt}ms request=${requestId}`));
    next();
  });

  app.get('/api/health', async (_request, response, next) => {
    try {
      const [health, provider] = await Promise.all([
        query(response, 'GetHealth', {}),
        query(response, 'GetProviderStatus', {}),
      ]);
      response.json({ ...health, provider, runtime: options.runtimeKind, featureFlags: options.featureFlags });
    } catch (error) { next(error); }
  });

  app.get('/api/workspace', async (_request, response, next) => {
    try {
      // ProviderService performs a one-time seed on first read. Keep these
      // compatibility queries ordered so two snapshots cannot race that seed.
      const workspace = await query(response, 'GetWorkspace', {});
      const provider = await query(response, 'GetProviderStatus', {});
      const providerCatalog = await query(response, 'GetProviders', {});
      response.json({ workspace, provider, providerCatalog });
    } catch (error) { next(error); }
  });

  app.get('/api/providers', async (_request, response, next) => {
    try { response.json({ catalog: await query(response, 'GetProviders', {}), presets: options.providerPresets }); }
    catch (error) { next(error); }
  });

  app.post('/api/providers', async (request, response, next) => {
    try { response.status(201).json({ catalog: await execute(response, 'SaveProvider', { body: request.body }) }); }
    catch (error) { next(error); }
  });

  app.put('/api/providers/:id', async (request, response, next) => {
    try { response.json({ catalog: await execute(response, 'SaveProvider', { providerId: request.params.id, body: request.body }) }); }
    catch (error) { next(error); }
  });

  app.post('/api/providers/:id/discover', async (request, response, next) => {
    try { response.json({ catalog: await execute(response, 'DiscoverProviderModels', { providerId: request.params.id }) }); }
    catch (error) { next(error); }
  });

  app.patch('/api/models/:id', async (request, response, next) => {
    try {
      const changes = request.body && typeof request.body === 'object' ? request.body as { favorite?: unknown; pinned?: unknown } : {};
      response.json({ catalog: await execute(response, 'UpdateModelPreference', {
        modelId: request.params.id,
        favorite: typeof changes.favorite === 'boolean' ? changes.favorite : undefined,
        pinned: typeof changes.pinned === 'boolean' ? changes.pinned : undefined,
      }) });
    } catch (error) { next(error); }
  });

  app.post('/api/models/:id/select', async (request, response, next) => {
    try {
      const catalog = await execute(response, 'SelectModel', { modelId: request.params.id });
      response.json({ catalog, provider: await query(response, 'GetProviderStatus', {}) });
    } catch (error) { next(error); }
  });

  app.post('/api/attachments', async (request, response, next) => {
    try {
      const name = typeof request.body?.name === 'string' ? request.body.name.trim().slice(0, 240) : '';
      const mimeType = typeof request.body?.mimeType === 'string' ? request.body.mimeType.toLowerCase().slice(0, 120) : 'application/octet-stream';
      const encoded = typeof request.body?.dataBase64 === 'string' ? request.body.dataBase64 : '';
      if (!name || !encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) rejectInput('附件名称或内容无效。', 'INVALID_ATTACHMENT');
      const bytes = Buffer.from(encoded, 'base64');
      response.status(201).json(await execute(response, 'RegisterLegacyAttachment', { name, mimeType, bytes }));
    } catch (error) { next(error); }
  });

  app.patch('/api/workspace/mode', async (request, response, next) => {
    try {
      const mode = request.body?.mode as ContextMode;
      if (!contextModes.has(mode)) rejectInput('无效的 Context 模式。', 'INVALID_MODE');
      response.json({ workspace: await execute(response, 'ChangeContextMode', { mode }) });
    } catch (error) { next(error); }
  });

  app.patch('/api/workspace/context/:id', async (request, response, next) => {
    try {
      const status = request.body?.status as ContextStatus | undefined;
      const pinned = request.body?.pinned as boolean | undefined;
      if (status !== undefined && !contextStatuses.has(status)) rejectInput('无效的 Context 状态。', 'INVALID_STATUS');
      if (pinned !== undefined && typeof pinned !== 'boolean') rejectInput('无效的 Pin 状态。', 'INVALID_PIN');
      if (status === undefined && pinned === undefined) rejectInput('没有可更新的 Context 字段。', 'EMPTY_CONTEXT_UPDATE');
      response.json({ workspace: await execute(response, 'ChangeContextSelection', { contextItemId: request.params.id, status, pinned }) });
    } catch (error) { next(error); }
  });

  app.post('/api/workspace/context', async (request, response, next) => {
    try {
      const sourceType = request.body?.sourceType as 'node' | 'segment' | 'file';
      const sourceId = typeof request.body?.sourceId === 'string' ? request.body.sourceId : '';
      if (!['node', 'segment', 'file'].includes(sourceType) || !sourceId) rejectInput('请选择有效的 Node、Segment 或 File。', 'INVALID_CONTEXT_SOURCE');
      response.status(201).json({ workspace: await execute(response, 'AddContextSource', { sourceType, sourceId }) });
    } catch (error) { next(error); }
  });

  app.post('/api/nodes', async (request, response, next) => {
    try {
      const title = typeof request.body?.title === 'string' ? request.body.title.trim() : '';
      const anchorText = typeof request.body?.anchorText === 'string' ? request.body.anchorText.trim().slice(0, 2000) : '';
      const sourceMessageId = typeof request.body?.sourceMessageId === 'string' ? request.body.sourceMessageId : undefined;
      const anchorStart = Number.isInteger(request.body?.anchorStart) ? Number(request.body.anchorStart) : undefined;
      const anchorEnd = Number.isInteger(request.body?.anchorEnd) ? Number(request.body.anchorEnd) : undefined;
      const messages: unknown[] = Array.isArray(request.body?.messages) ? request.body.messages.slice(0, 40) : [];
      if (!title || title.length > 120) rejectInput('支线标题不能为空且不能超过 120 字符。', 'INVALID_NODE_TITLE');
      if (!messages.every(isDraftMessage)) rejectInput('临时支线消息格式无效。', 'INVALID_BRANCH_MESSAGES');
      response.status(201).json({ workspace: await execute(response, 'CreateBranch', {
        title, anchorText, sourceMessageId, anchorStart, anchorEnd, messages: messages as DraftMessageInput[],
      }) });
    } catch (error) { next(error); }
  });

  app.post('/api/graph/nodes', async (request, response, next) => {
    try {
      const title = typeof request.body?.title === 'string' ? request.body.title.trim() : '';
      const summary = typeof request.body?.summary === 'string' ? request.body.summary.trim().slice(0, 500) : '';
      const x = Number(request.body?.x ?? 180); const y = Number(request.body?.y ?? 140);
      if (!title || title.length > 120) rejectInput('节点标题不能为空且不能超过 120 字符。', 'INVALID_NODE_TITLE');
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 5000 || y > 5000) rejectInput('节点坐标无效。', 'INVALID_POSITION');
      response.status(201).json({ workspace: await execute(response, 'CreateGraphNode', { title, summary, x, y }) });
    } catch (error) { next(error); }
  });

  app.post('/api/temp-chat', async (request, response, next) => {
    try {
      const sourceNodeId = typeof request.body?.sourceNodeId === 'string' ? request.body.sourceNodeId : '';
      const anchorText = typeof request.body?.anchorText === 'string' ? request.body.anchorText.trim().slice(0, 4000) : '';
      const prompt = typeof request.body?.message === 'string' ? request.body.message.trim() : '';
      const history: unknown[] = Array.isArray(request.body?.history) ? request.body.history.slice(-20) : [];
      if (!sourceNodeId || !anchorText || !prompt || prompt.length > 20_000) rejectInput('临时支线需要来源节点、内容锚点和有效问题。', 'INVALID_TEMP_CHAT');
      if (!history.every(isDraftMessage)) rejectInput('临时对话历史格式无效。', 'INVALID_TEMP_HISTORY');
      response.status(201).json(await execute(response, 'ExecuteTemporaryConversation', { sourceNodeId, anchorText, prompt, history: history as DraftMessageInput[] }));
    } catch (error) { next(error); }
  });

  app.post('/api/nodes/:id/activate', async (request, response, next) => {
    try { response.json({ workspace: await execute(response, 'ActivateNode', { nodeId: request.params.id }) }); }
    catch (error) { next(error); }
  });

  app.patch('/api/nodes/:id/status', async (request, response, next) => {
    try {
      const status = request.body?.status;
      if (!['draft', 'active', 'resolved', 'stale', 'archived'].includes(status)) rejectInput('无效的节点状态。', 'INVALID_NODE_STATUS');
      response.json({ workspace: await execute(response, 'ChangeNodeStatus', { nodeId: request.params.id, status }) });
    } catch (error) { next(error); }
  });

  app.post('/api/nodes/:id/segments', async (request, response, next) => {
    try {
      const title = typeof request.body?.title === 'string' ? request.body.title.trim() : '';
      const messageIds = Array.isArray(request.body?.messageIds)
        ? [...new Set<string>((request.body.messageIds as unknown[]).filter((id): id is string => typeof id === 'string'))]
        : [];
      if (!title || title.length > 200) rejectInput('Segment 标题不能为空且不能超过 200 字符。', 'INVALID_SEGMENT_TITLE');
      response.status(201).json(await execute(response, 'CreateSegment', { nodeId: request.params.id, title, messageIds }));
    } catch (error) { next(error); }
  });

  app.patch('/api/nodes/:id/position', async (request, response, next) => {
    try {
      const x = Number(request.body?.x); const y = Number(request.body?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 5000 || y > 5000) rejectInput('节点坐标无效。', 'INVALID_POSITION');
      response.json({ workspace: await execute(response, 'UpdateGraphLayout', { positions: [{ nodeId: request.params.id, x, y }] }) });
    } catch (error) { next(error); }
  });

  app.delete('/api/graph/nodes/:id', async (request, response, next) => {
    try { response.json({ workspace: await execute(response, 'ArchiveObject', { nodeId: request.params.id }) }); }
    catch (error) { next(error); }
  });

  app.post('/api/graph/nodes/:id/purge', async (request, response, next) => {
    try {
      response.json(await execute(response, 'PurgeObject', {
        nodeId: request.params.id,
        confirmation: typeof request.body?.confirmation === 'string' ? request.body.confirmation : '',
        reason: typeof request.body?.reason === 'string' ? request.body.reason.trim() : '',
      }));
    } catch (error) { next(error); }
  });

  app.post('/api/graph/edges', async (request, response, next) => {
    try {
      const source = typeof request.body?.source === 'string' ? request.body.source : '';
      const target = typeof request.body?.target === 'string' ? request.body.target : '';
      const relation = typeof request.body?.relation === 'string' ? request.body.relation : 'related-to';
      const label = typeof request.body?.label === 'string' ? request.body.label.trim().slice(0, 120) : '';
      if (!source || !target || source === target || !edgeRelations.has(relation as never)) rejectInput('关系必须连接两个不同的节点，并使用有效关系类型。', 'INVALID_EDGE');
      if (!label) rejectInput('关系标签不能为空。', 'INVALID_EDGE_LABEL');
      response.status(201).json({ workspace: await execute(response, 'CreateRelation', { source, target, relation: relation as CommandMap['CreateRelation']['payload']['relation'], label }) });
    } catch (error) { next(error); }
  });

  app.delete('/api/graph/edges/:id', async (request, response, next) => {
    try { response.json({ workspace: await execute(response, 'RemoveRelation', { edgeId: request.params.id }) }); }
    catch (error) { next(error); }
  });

  app.post('/api/nodes/:id/merge', async (request, response, next) => {
    try {
      response.json({ workspace: await execute(response, 'CreateMergeRevision', {
        sourceNodeId: request.params.id,
        targetNodeId: typeof request.body?.targetNodeId === 'string' ? request.body.targetNodeId : undefined,
        summary: typeof request.body?.summary === 'string' && request.body.summary.trim() ? request.body.summary.trim().slice(0, 5000) : undefined,
      }) });
    } catch (error) { next(error); }
  });

  app.post('/api/chat/stream', async (request, response, next) => {
    const controller = new AbortController();
    let terminalRuntimeErrorObserved = false;
    response.on('close', () => { if (!response.writableEnded) controller.abort(); });
    try {
      const result = await execute(response, 'CreateConversationRun', parseChatInput(request.body), {
        signal: controller.signal,
        onReady: () => {
          response.status(200);
          response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          response.setHeader('Cache-Control', 'no-cache, no-transform');
          response.setHeader('Connection', 'keep-alive');
          response.setHeader('X-Accel-Buffering', 'no');
          response.flushHeaders();
        },
        onRuntimeEvent: event => {
          terminalRuntimeErrorObserved ||= event.type === 'RUN_ERROR';
          writeSse(response, 'runtime', event);
        },
      });
      writeSse(response, 'commit', { type: 'COMMIT', ...result });
      response.end();
    } catch (error) {
      if (!response.headersSent) return next(error);
      if (response.writableEnded || response.destroyed) return;
      if (!terminalRuntimeErrorObserved) {
        const normalized = error instanceof ApplicationError ? error : applicationError('AI Runtime 流式执行失败。', 'RUNTIME_ERROR', 'infrastructure', 'retry', true, 502);
        writeSse(response, 'runtime', {
          type: 'RUN_ERROR', requestId: correlationId(response), code: normalized.details.code, message: normalized.message,
          status: normalized.details.status, category: normalized.details.category, retryable: normalized.details.retryable,
          correlationId: correlationId(response),
        });
      }
      response.end();
    }
  });

  app.post('/api/chat', async (request, response, next) => {
    try { response.status(201).json(await execute(response, 'CreateConversationRun', parseChatInput(request.body))); }
    catch (error) { next(error); }
  });

  if (options.frontendDirectory) {
    app.use(express.static(options.frontendDirectory));
    app.get('*path', (_request, response) => response.sendFile(`${options.frontendDirectory}/index.html`));
  }

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof ApplicationError) {
      return response.status(error.details.status).json({ error: {
        code: error.details.code,
        message: error.message,
        category: error.details.category,
        retryable: error.details.retryable,
        recovery: error.details.recovery,
        correlationId: correlationId(response),
      } });
    }
    log.error('[api] unhandled request error', error);
    return response.status(500).json({ error: {
      code: 'INTERNAL_ERROR', message: '服务器处理请求时发生错误。', category: 'infrastructure', retryable: true,
      recovery: 'retry', correlationId: correlationId(response),
    } });
  });

  return app;
}
