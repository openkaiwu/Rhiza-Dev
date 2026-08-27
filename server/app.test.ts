// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from './app';
import type { AIRuntime } from './ai-runtime';
import { ProviderService } from './provider-service';
import { ProviderStore } from './provider-store';
import { SecretVault } from './secret-vault';
import { WorkspaceStore } from './store';

const temporaryDirectories: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()))));
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function testApp(runtime?: AIRuntime) {
  const directory = await mkdtemp(join(tmpdir(), 'rhiza-'));
  temporaryDirectories.push(directory);
  const store = new WorkspaceStore(join(directory, 'workspace.json'));
  const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: '后端生成的回答' } }] }), { status: 200 })) as unknown as typeof fetch;
  const provider = new ProviderService(new ProviderStore(join(directory, 'providers.json')), new SecretVault(join(directory, '.provider-key')), { baseUrl: 'https://example.test/v1', apiKey: 'test-key', model: 'test-model', providerName: 'Test', chatPath: '/chat/completions', timeoutMs: 1000, temperature: 0.4, extraHeaders: {}, allowNoKey: false }, fetcher);
  const server = createServer(createApp(store, provider, false, runtime, undefined, join(directory, 'uploads')));
  await new Promise<void>((resolveListen, rejectListen) => server.listen(0, '127.0.0.1', resolveListen).once('error', rejectListen));
  servers.push(server);
  return { app: server, store, filePath: join(directory, 'workspace.json'), providerPath: join(directory, 'providers.json'), fetcher: fetcher as unknown as ReturnType<typeof vi.fn> };
}

describe('Rhiza API', () => {
  it('scopes workspace lifecycle to the v1 path, not request body', async () => {
    const { app } = await testApp();
    const created = await request(app).post('/api/v1/workspaces').send({ name: 'Second', workspaceId: 'forged' }).expect(201);
    const id = created.body.workspace.workspaceId as string;
    expect(id).not.toBe('forged');
    await request(app).patch(`/api/v1/workspaces/${id}`).send({ action: 'rename', name: 'Renamed', workspaceId: 'forged' }).expect(200);
    await request(app).post(`/api/v1/workspaces/${id}/switch`).send({ workspaceId: 'forged' }).expect(200);
    await request(app).patch(`/api/v1/workspaces/${id}`).send({ action: 'archive' }).expect(200);
    await request(app).patch(`/api/v1/workspaces/${id}`).send({ action: 'restore' }).expect(200);
    const listed = await request(app).get('/api/v1/workspaces').expect(200);
    expect(listed.body.workspaces).toEqual(expect.arrayContaining([expect.objectContaining({ workspaceId: id, name: 'Renamed', status: 'active' })]));
  });
  it('keeps scoped writes invisible across workspaces and preserves legacy default', async () => {
    const { app } = await testApp();
    const legacyBefore = await request(app).get('/api/workspace').expect(200);
    const created = await request(app).post('/api/v1/workspaces').send({ name: 'Isolation' }).expect(201);
    const id = created.body.workspace.workspaceId as string;
    await request(app).post(`/api/v1/workspaces/${id}/graph/nodes`).send({ title: 'Only here' }).expect(201);
    expect((await request(app).get(`/api/v1/workspaces/${id}`)).body.workspace.discussionNodes.map((node: { title: string }) => node.title)).toContain('Only here');
    expect((await request(app).get('/api/workspace')).body.workspace.discussionNodes.map((node: { title: string }) => node.title)).not.toContain('Only here');
    expect((await request(app).get('/api/workspace')).body.workspace.projectId).toBe(legacyBefore.body.workspace.projectId);
    await request(app).patch(`/api/v1/workspaces/${id}`).send({ action: 'archive' }).expect(200);
    await request(app).post(`/api/v1/workspaces/${id}/graph/nodes`).send({ title: 'Denied' }).expect(409);
    await request(app).patch(`/api/v1/workspaces/${id}`).send({ action: 'restore' }).expect(200);
  });
  it('routes attachment, context, graph and chat writes to the path workspace', async () => {
    const { app } = await testApp();
    const id = (await request(app).post('/api/v1/workspaces').send({ name: 'Scoped', workspaceId: 'forged' }).expect(201)).body.workspace.workspaceId;
    const attachment = await request(app).post(`/api/v1/workspaces/${id}/attachments`).send({ name: 'scope.txt', mimeType: 'text/plain', dataBase64: Buffer.from('scoped').toString('base64'), workspaceId: 'forged' }).expect(201);
    const node = (await request(app).post(`/api/v1/workspaces/${id}/graph/nodes`).send({ title: 'Scoped graph' }).expect(201)).body.workspace.discussionNodes.at(-1);
    await request(app).post(`/api/v1/workspaces/${id}/workspace/context`).send({ sourceType: 'node', sourceId: node.id, workspaceId: 'forged' }).expect(201);
    await request(app).post(`/api/v1/workspaces/${id}/chat`).send({ message: 'scoped chat', workspaceId: 'forged' }).expect(201);
    const stream = await request(app).post(`/api/v1/workspaces/${id}/chat/stream`).send({ message: 'scoped stream', workspaceId: 'forged' }).expect(200).expect('Content-Type', /text\/event-stream/);
    expect(stream.text).toContain('event: commit');
    const scoped = (await request(app).get(`/api/v1/workspaces/${id}`).expect(200)).body.workspace;
    const legacy = (await request(app).get('/api/workspace').expect(200)).body.workspace;
    expect(scoped.attachments).toEqual(expect.arrayContaining([expect.objectContaining({ id: attachment.body.attachment.id })]));
    expect(scoped.discussionNodes).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Scoped graph' })]));
    expect(scoped.messages).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'scoped chat' })]));
    expect(scoped.messages).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'scoped stream' })]));
    expect(legacy.attachments).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: attachment.body.attachment.id })]));
    expect(legacy.discussionNodes).not.toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Scoped graph' })]));
    expect(legacy.messages).not.toEqual(expect.arrayContaining([expect.objectContaining({ text: 'scoped chat' }), expect.objectContaining({ text: 'scoped stream' })]));
  });
  it('never serializes upstream runtime secrets in JSON or SSE errors', async () => {
    const upstreamSecret = 'upstream-secret-token-123';
    const failedRuntime: AIRuntime = {
      kind: 'provider-adapter',
      listModels: async () => [{ id: 'model-1', provider: 'Fixture', model: 'fixture', displayName: 'Fixture', active: true }],
      async *generate(input) {
        yield { type: 'RUN_START' as const, requestId: input.requestId, manifestId: input.manifestId, model: 'fixture', provider: 'Fixture' };
        yield { type: 'RUN_ERROR' as const, requestId: input.requestId, code: 'PROVIDER_REQUEST_FAILED', message: `provider rejected ${upstreamSecret}`, status: 502 };
      },
    };
    const { app } = await testApp(failedRuntime);
    const json = await request(app).post('/api/chat').send({ message: 'trigger error' }).expect(502);
    expect(JSON.stringify(json.body)).not.toContain(upstreamSecret);
    expect(json.body.error).toMatchObject({ code: 'PROVIDER_REQUEST_FAILED', category: 'infrastructure', retryable: true, correlationId: expect.any(String) });
    const stream = await request(app).post('/api/chat/stream').send({ message: 'trigger error' }).expect(200);
    expect(stream.text).not.toContain(upstreamSecret);
    expect(stream.text).toContain('AI Runtime 执行失败，请稍后重试。');
    expect(stream.text).toContain('correlationId');
  });

  it('persists context status updates', async () => {
    const { app, filePath } = await testApp();
    await request(app).patch('/api/workspace/context/c3').send({ status: 'active' }).expect(200);
    const persisted = JSON.parse(await readFile(filePath, 'utf8'));
    expect(persisted.contextItems.find((item: { id: string }) => item.id === 'c3').status).toBe('active');
    expect(persisted.contextItems.find((item: { id: string }) => item.id === 'c3').selectionMode).toBe('AI_RECOMMENDED_ACCEPTED');
  });

  it('adds Node and Segment sources and supports pin, remove, exclude and restore', async () => {
    const { app } = await testApp();
    const nodeResponse = await request(app).post('/api/graph/nodes').send({ title: '上下文来源节点', summary: '用于 M4 验收', x: 620, y: 260 }).expect(201);
    const node = nodeResponse.body.workspace.discussionNodes.find((item: { title: string }) => item.title === '上下文来源节点');
    const segmentResponse = await request(app).post(`/api/nodes/${node.id}/segments`).send({ title: '验收片段', messageIds: [] }).expect(201);
    const segment = segmentResponse.body.segment;

    const addedNode = await request(app).post('/api/workspace/context').send({ sourceType: 'node', sourceId: node.id }).expect(201);
    const nodeContext = addedNode.body.workspace.contextItems.find((item: { sourceId?: string }) => item.sourceId === node.id);
    expect(nodeContext).toMatchObject({ sourceType: 'node', status: 'active', selectionMode: 'USER_SELECTED' });
    await request(app).patch(`/api/workspace/context/${nodeContext.id}`).send({ pinned: true }).expect(200);
    await request(app).patch(`/api/workspace/context/${nodeContext.id}`).send({ status: 'recommended' }).expect(200);
    await request(app).patch(`/api/workspace/context/${nodeContext.id}`).send({ status: 'excluded' }).expect(200);
    const restored = await request(app).patch(`/api/workspace/context/${nodeContext.id}`).send({ status: 'active' }).expect(200);
    expect(restored.body.workspace.contextItems.find((item: { id: string }) => item.id === nodeContext.id)).toMatchObject({ status: 'active', pinned: false });

    const addedSegment = await request(app).post('/api/workspace/context').send({ sourceType: 'segment', sourceId: segment.id }).expect(201);
    expect(addedSegment.body.workspace.contextItems).toEqual(expect.arrayContaining([expect.objectContaining({ sourceType: 'segment', sourceId: segment.id, sourceNodeId: node.id })]));
  });

  it('preserves pinned context over budget and freezes a new immutable manifest for Regenerate', async () => {
    const { app, store } = await testApp();
    await store.update(current => ({ ...current, contextItems: current.contextItems.map(item => item.id === 'c2' ? { ...item, tokens: 40_000, pinned: true } : item) }));
    const first = await request(app).post('/api/chat').send({ message: '比较上下文' }).expect(201);
    expect(first.body.manifest.estimatedTokens).toBeGreaterThan(32_000);
    expect(first.body.manifest.contextItems).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: 'interview-round-02', pinned: true, tokenCount: 40_000 })]));

    await request(app).patch('/api/workspace/context/c2').send({ status: 'excluded' }).expect(200);
    const regenerated = await request(app).post('/api/chat').send({ message: '占位', operation: 'regenerate', sourceMessageId: first.body.assistantMessage.id }).expect(201);
    expect(regenerated.body.manifest.id).not.toBe(first.body.manifest.id);
    expect(regenerated.body.manifest.contextItemIds).not.toContain('c2');
    const snapshot = await request(app).get('/api/workspace').expect(200);
    expect(snapshot.body.workspace.manifests[0]).toEqual(first.body.manifest);
    expect(snapshot.body.workspace.manifests).toHaveLength(2);
  });

  it('calls the provider and stores messages with a manifest', async () => {
    const { app } = await testApp();
    const response = await request(app).post('/api/chat').send({ message: '生成可执行建议' }).expect(201);
    expect(response.body.assistantMessage.text).toBe('后端生成的回答');
    expect(response.body.manifest.contextItemIds).toEqual(['c1', 'c2']);
    expect(response.body.manifest).toMatchObject({
      projectId: 'rhiza-product-research', nodeId: 'information-architecture',
      provider: 'Test', model: 'test-model', runtime: 'provider-adapter', excludedItemIds: ['c4'],
    });
    expect(response.body.manifest.requestId).toEqual(expect.any(String));
    expect(response.body.manifest.contextItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'information-architecture', sourceType: 'node', title: '信息架构方向', selectionMode: 'CURRENT', contentVersion: 1 }),
      expect.objectContaining({ sourceId: 'interview-round-02', sourceType: 'reference', selectionMode: 'USER_SELECTED', pinned: true }),
    ]));
    const workspace = await request(app).get('/api/workspace').expect(200);
    expect(workspace.body.workspace.messages).toHaveLength(4);
    expect(workspace.body.workspace.manifests).toHaveLength(1);
  });

  it('streams runtime events before atomically committing the discussion turn', async () => {
    const { app } = await testApp();
    const response = await request(app).post('/api/chat/stream').send({ message: '用事件流回答' }).expect(200).expect('Content-Type', /text\/event-stream/);
    expect(response.text).toContain('event: runtime');
    expect(response.text).toContain('"type":"RUN_START"');
    expect(response.text).toContain('"type":"CONTENT_DELTA"');
    expect(response.text).toContain('"type":"RUN_END"');
    expect(response.text).toContain('event: commit');
    expect(response.text).toContain('"type":"COMMIT"');
    const workspace = await request(app).get('/api/workspace').expect(200);
    expect(workspace.body.workspace.messages.slice(-2).map((message: { text: string }) => message.text)).toEqual(['用事件流回答', '后端生成的回答']);
    expect(workspace.body.workspace.manifests).toHaveLength(1);
  });

  it('refuses to commit a chat run when its node is archived during generation', async () => {
    let signalStarted!: () => void;
    let releaseGeneration!: () => void;
    const started = new Promise<void>(resolve => { signalStarted = resolve; });
    const generationGate = new Promise<void>(resolve => { releaseGeneration = resolve; });
    const gatedRuntime: AIRuntime = {
      kind: 'provider-adapter',
      listModels: async () => [{ id: 'model-1', provider: 'Concurrency Fixture', model: 'gated-model', displayName: 'Gated', active: true }],
      async *generate(input) {
        signalStarted();
        yield { type: 'RUN_START', requestId: input.requestId, manifestId: input.manifestId, model: 'gated-model', provider: 'Concurrency Fixture' };
        await generationGate;
        yield { type: 'RUN_END', requestId: input.requestId, text: '归档后不得提交', model: 'gated-model', provider: 'Concurrency Fixture' };
      },
    };
    const { app } = await testApp(gatedRuntime);
    await request(app).post('/api/graph/nodes').send({ title: '归档后的后备节点', x: 620, y: 280 }).expect(201);

    const pendingChat = request(app).post('/api/chat').send({ message: '并发归档检查' }).then(response => response);
    await started;
    await request(app).delete('/api/graph/nodes/information-architecture').expect(200);
    releaseGeneration();

    const rejected = await pendingChat;
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe('NODE_ARCHIVED_DURING_RUN');
    const workspace = (await request(app).get('/api/workspace').expect(200)).body.workspace;
    expect(workspace.messages).toHaveLength(2);
    expect(workspace.manifests).toEqual([]);
    expect(workspace.discussionNodes.find((node: { id: string }) => node.id === 'information-architecture')).toMatchObject({ status: 'archived' });
  });

  it('does not persist a partial assistant response when a runtime stream fails', async () => {
    const failingRuntime: AIRuntime = {
      kind: 'librechat',
      listModels: async () => [{ id: 'model-1', provider: 'LibreChat', model: 'test-model', displayName: 'Test', active: true }],
      async *generate(input) {
        yield { type: 'RUN_START', requestId: input.requestId, manifestId: input.manifestId, model: 'test-model', provider: 'LibreChat' };
        yield { type: 'CONTENT_DELTA', requestId: input.requestId, delta: '未完成内容' };
        yield { type: 'RUN_ERROR', requestId: input.requestId, code: 'UPSTREAM_STREAM_FAILED', message: '上游流中断', status: 502 };
      },
    };
    const { app } = await testApp(failingRuntime);
    const before = await request(app).get('/api/workspace').expect(200);
    expect(before.body.provider).toMatchObject({ configured: true, name: 'LibreChat', model: 'Test' });
    const response = await request(app).post('/api/chat/stream').send({ message: '这条消息不应落盘' }).expect(200);
    expect(response.text).toContain('"type":"RUN_ERROR"');
    expect(response.text).not.toContain('event: commit');
    const after = await request(app).get('/api/workspace').expect(200);
    expect(after.body.workspace.messages).toEqual(before.body.workspace.messages);
    expect(after.body.workspace.manifests).toEqual([]);
  });

  it('keeps a failed stream uncommitted and retries without overwriting history', async () => {
    let attempts = 0;
    const retryRuntime: AIRuntime = {
      kind: 'provider-adapter',
      listModels: async () => [{ id: 'model-1', provider: 'Retry Fixture', model: 'retry-model', displayName: 'Retry', active: true }],
      async *generate(input) {
        attempts += 1;
        yield { type: 'RUN_START', requestId: input.requestId, manifestId: input.manifestId, model: 'retry-model', provider: 'Retry Fixture' };
        if (attempts === 1) { yield { type: 'RUN_ERROR', requestId: input.requestId, code: 'UPSTREAM_TIMEOUT', message: 'synthetic timeout', status: 504 }; return; }
        yield { type: 'CONTENT_DELTA', requestId: input.requestId, delta: '重试完成' };
        yield { type: 'RUN_END', requestId: input.requestId, text: '重试完成', model: 'retry-model', provider: 'Retry Fixture' };
      },
    };
    const { app } = await testApp(retryRuntime);
    await request(app).post('/api/chat').send({ message: '需要重试' }).expect(504);
    expect((await request(app).get('/api/workspace')).body.workspace.manifests).toEqual([]);
    const retried = await request(app).post('/api/chat').send({ message: '需要重试', operation: 'retry' }).expect(201);
    expect(retried.body.userMessage).toMatchObject({ text: '需要重试', operation: 'retry' });
    expect(retried.body.assistantMessage).toMatchObject({ text: '重试完成', operation: 'retry' });
    expect(retried.body.manifest).toMatchObject({ operation: 'retry' });
    const after = await request(app).get('/api/workspace').expect(200);
    expect(after.body.workspace.messages.slice(-2).map((message: { text: string }) => message.text)).toEqual(['需要重试', '重试完成']);
    expect(after.body.workspace.messages).toHaveLength(4);
    expect(after.body.workspace.manifests).toHaveLength(1);
  });

  it('validates client input', async () => {
    const { app } = await testApp();
    await request(app).post('/api/chat').send({ message: '   ' }).expect(400);
    await request(app).patch('/api/workspace/mode').send({ mode: 'Unknown' }).expect(400);
  });

  it('stores API keys encrypted and never returns them', async () => {
    const { app, providerPath } = await testApp();
    const response = await request(app).post('/api/providers').send({ preset: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'secret-plain-key', allowNoKey: false, modelId: 'deepseek-chat' }).expect(201);
    expect(JSON.stringify(response.body)).not.toContain('secret-plain-key');
    expect(await readFile(providerPath, 'utf8')).not.toContain('secret-plain-key');
    expect(response.body.catalog.providers.some((provider: { name: string; hasApiKey: boolean }) => provider.name === 'DeepSeek' && provider.hasApiKey)).toBe(true);
    expect(response.body.catalog.modelSpecs).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'deepseek-chat', group: 'DeepSeek', preset: expect.objectContaining({ endpoint: 'custom', model: 'deepseek-chat' }) }),
    ]));
    expect(response.body.catalog.filePolicy).toMatchObject({ disabled: false, maxFiles: 10 });
    expect(response.body.catalog.filePolicy.supportedMimeTypes).toContain('application/pdf');
  });

  it('persists model selection, favorite and pin state', async () => {
    const { app } = await testApp();
    const catalog = await request(app).get('/api/providers').expect(200);
    const modelId = catalog.body.catalog.models[0].id;
    await request(app).patch(`/api/models/${modelId}`).send({ favorite: true, pinned: true }).expect(200);
    const selected = await request(app).post(`/api/models/${modelId}/select`).expect(200);
    expect(selected.body.catalog.activeModelId).toBe(modelId);
    expect(selected.body.catalog.models[0]).toMatchObject({ favorite: true, pinned: true });
  });

  it('creates, moves and merges a formal discussion branch', async () => {
    const { app, filePath } = await testApp();
    const created = await request(app).post('/api/nodes').send({ title: '检索策略支线', sourceMessageId: 'm2', anchorText: '渐进式上下文', anchorStart: 16, anchorEnd: 23, messages: [{ kind: 'user', text: '临时问题', createdAt: '2026-08-09T12:00:20.000Z' }, { kind: 'assistant', text: '临时结论', createdAt: '2026-08-09T12:00:21.000Z' }] }).expect(201);
    const branch = created.body.workspace.discussionNodes.find((node: { kind: string }) => node.kind === 'branch');
    expect(branch).toMatchObject({ title: '检索策略支线', sourceNodeId: 'information-architecture', status: 'active' });
    const anchor = created.body.workspace.anchors[0];
    expect(anchor).toMatchObject({ nodeId: 'information-architecture', messageId: 'm2', selectedText: '渐进式上下文' });
    expect(created.body.workspace.discussionEdges[0]).toMatchObject({ source: 'information-architecture', target: branch.id, relation: 'derived-from', anchorId: anchor.id });
    expect(created.body.workspace.messages.filter((message: { nodeId: string }) => message.nodeId === branch.id).map((message: { text: string }) => message.text)).toEqual(['临时问题', '临时结论']);

    await request(app).patch(`/api/nodes/${branch.id}/position`).send({ x: 612, y: 286 }).expect(200);
    const merged = await request(app).post(`/api/nodes/${branch.id}/merge`).send({ summary: '采用分层检索并保留来源锚点。' }).expect(200);
    expect(merged.body.workspace.activeNodeId).toBe('information-architecture');
    expect(merged.body.workspace.discussionNodes.find((node: { id: string }) => node.id === branch.id)).toMatchObject({ x: 612, y: 286, status: 'resolved' });
    expect(merged.body.workspace.discussionEdges.some((edge: { relation: string }) => edge.relation === 'merged-into')).toBe(true);
    expect(JSON.parse(await readFile(filePath, 'utf8')).discussionNodes).toHaveLength(2);
  });

  it('archives graph nodes idempotently without losing their complete history', async () => {
    const { app } = await testApp();
    const initial = await request(app).get('/api/workspace').expect(200);
    const messageIds = initial.body.workspace.messages.map((message: { id: string }) => message.id);
    const segmented = await request(app).post('/api/nodes/information-architecture/segments').send({ title: '访谈结论', messageIds }).expect(201);
    expect(segmented.body.segment).toMatchObject({ nodeId: 'information-architecture', ordinal: 1, title: '访谈结论' });
    expect(segmented.body.workspace.messages.every((message: { segmentId: string }) => message.segmentId === segmented.body.segment.id)).toBe(true);

    const branchResponse = await request(app).post('/api/nodes').send({ title: '可归档支线', sourceMessageId: 'm2', anchorText: '渐进式上下文', messages: [{ kind: 'user', text: '支线历史' }] }).expect(201);
    const branch = branchResponse.body.workspace.discussionNodes.find((node: { title: string }) => node.title === '可归档支线');
    const chat = await request(app).post('/api/chat').send({ message: '支线结论' }).expect(201);
    const afterChat = await request(app).get('/api/workspace').expect(200);
    const branchMessageIds = afterChat.body.workspace.messages.filter((message: { nodeId: string }) => message.nodeId === branch.id).map((message: { id: string }) => message.id);
    const branchSegment = await request(app).post(`/api/nodes/${branch.id}/segments`).send({ title: '支线片段', messageIds: branchMessageIds }).expect(201);
    const beforeArchive = branchSegment.body.workspace;
    const archived = await request(app).delete(`/api/graph/nodes/${branch.id}`).expect(200);
    expect(archived.body.workspace.activeNodeId).toBe('information-architecture');
    expect(archived.body.workspace.discussionNodes.find((node: { id: string }) => node.id === branch.id)).toMatchObject({ status: 'archived' });
    expect(archived.body.workspace.messages.filter((message: { nodeId: string }) => message.nodeId === branch.id)).toEqual(beforeArchive.messages.filter((message: { nodeId: string }) => message.nodeId === branch.id));
    expect(archived.body.workspace.segments).toContainEqual(branchSegment.body.segment);
    expect(archived.body.workspace.manifests).toContainEqual(chat.body.manifest);
    expect(archived.body.workspace.anchors).toEqual(beforeArchive.anchors);
    expect(archived.body.workspace.discussionEdges).toEqual(beforeArchive.discussionEdges);
    await request(app).delete(`/api/graph/nodes/${branch.id}`).expect(200);
    await request(app).post(`/api/nodes/${branch.id}/activate`).expect(409);
    await request(app).post(`/api/nodes/${branch.id}/segments`).send({ title: '不可改写', messageIds: branchMessageIds }).expect(409);
    await request(app).patch(`/api/nodes/${branch.id}/position`).send({ x: 100, y: 100 }).expect(409);
    await request(app).patch(`/api/nodes/${branch.id}/status`).send({ status: 'resolved' }).expect(409);
    await request(app).post(`/api/nodes/${branch.id}/merge`).send({ summary: '不可合并' }).expect(409);
    await request(app).post('/api/graph/edges').send({ source: 'information-architecture', target: branch.id, relation: 'references', label: '不可新增' }).expect(409);
    const derivedEdge = archived.body.workspace.discussionEdges.find((edge: { target: string }) => edge.target === branch.id);
    await request(app).delete(`/api/graph/edges/${derivedEdge.id}`).expect(409);
    const restored = await request(app).patch(`/api/nodes/${branch.id}/status`).send({ status: 'active' }).expect(200);
    expect(restored.body.workspace.discussionNodes.find((node: { id: string }) => node.id === branch.id)).toMatchObject({ status: 'active' });
    await request(app).post(`/api/nodes/${branch.id}/activate`).expect(200);
  });

  it('isolates physical purge behind archived state, explicit confirmation and an audit receipt', async () => {
    const { app } = await testApp();
    const created = await request(app).post('/api/nodes').send({ title: '待清除支线', sourceMessageId: 'm2', messages: [{ kind: 'user', text: '需要受控清除的内容' }] }).expect(201);
    const nodeId = created.body.workspace.activeNodeId as string;
    await request(app).post('/api/chat').send({ message: '生成待清除 Manifest' }).expect(201);
    const afterChat = await request(app).get('/api/workspace').expect(200);
    const nodeMessageIds = afterChat.body.workspace.messages.filter((message: { nodeId: string }) => message.nodeId === nodeId).map((message: { id: string }) => message.id);
    const segmentResponse = await request(app).post(`/api/nodes/${nodeId}/segments`).send({ title: '待清除片段', messageIds: nodeMessageIds }).expect(201);
    const segmentId = segmentResponse.body.segment.id as string;
    await request(app).post('/api/workspace/context').send({ sourceType: 'node', sourceId: nodeId }).expect(201);
    await request(app).post('/api/workspace/context').send({ sourceType: 'segment', sourceId: segmentId }).expect(201);

    await request(app).post(`/api/graph/nodes/${nodeId}/purge`).send({ confirmation: `PURGE ${nodeId}`, reason: '测试显式物理清除' }).expect(409);
    await request(app).delete(`/api/graph/nodes/${nodeId}`).expect(200);
    await request(app).post(`/api/graph/nodes/${nodeId}/purge`).send({ confirmation: 'PURGE wrong-id', reason: '测试显式物理清除' }).expect(400);

    const purged = await request(app).post(`/api/graph/nodes/${nodeId}/purge`).send({ confirmation: `PURGE ${nodeId}`, reason: '测试显式物理清除' }).expect(200);
    expect(purged.body.workspace.discussionNodes.some((node: { id: string }) => node.id === nodeId)).toBe(false);
    expect(purged.body.workspace.messages.some((message: { nodeId: string }) => message.nodeId === nodeId)).toBe(false);
    expect(purged.body.workspace.segments.some((segment: { nodeId: string }) => segment.nodeId === nodeId)).toBe(false);
    expect(purged.body.workspace.manifests.some((manifest: { nodeId: string }) => manifest.nodeId === nodeId)).toBe(false);
    expect(purged.body.workspace.contextItems.some((item: { sourceId?: string; sourceNodeId?: string }) => item.sourceId === nodeId || item.sourceId === segmentId || item.sourceNodeId === nodeId)).toBe(false);
    expect(purged.body.purgeReceipt).toMatchObject({ action: 'node.purged', entityType: 'node', entityId: nodeId, metadata: { reason: '测试显式物理清除', confirmation: 'explicit-id-phrase' } });
  });

  it('keeps runtime history and persisted messages scoped to the active graph node', async () => {
    const { app, fetcher } = await testApp();
    const created = await request(app).post('/api/nodes').send({ title: '隔离支线', anchorText: '只研究这条路径' }).expect(201);
    const branchId = created.body.workspace.activeNodeId;

    const response = await request(app).post('/api/chat').send({ message: '支线中的第一个问题' }).expect(201);
    expect(response.body.userMessage.nodeId).toBe(branchId);
    expect(response.body.assistantMessage.nodeId).toBe(branchId);
    expect(response.body.manifest.nodeId).toBe(branchId);

    const providerBody = JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body));
    expect(providerBody.messages.map((message: { content: string }) => message.content)).not.toContain(expect.stringContaining('结合前两轮访谈'));
    expect(providerBody.messages.at(-1).content).toBe('支线中的第一个问题');
  });

  it('creates graph nodes and semantic edges while retaining archived nodes', async () => {
    const { app } = await testApp();
    const createdNode = await request(app).post('/api/graph/nodes').send({ title: '检索实验', summary: '验证关系图谱编辑能力', x: 620, y: 280 }).expect(201);
    const node = createdNode.body.workspace.discussionNodes.find((item: { title: string }) => item.title === '检索实验');
    expect(node).toMatchObject({ status: 'draft', kind: 'branch', x: 620, y: 280 });
    const createdEdge = await request(app).post('/api/graph/edges').send({ source: 'information-architecture', target: node.id, relation: 'related-to', label: '实验关联' }).expect(201);
    const edge = createdEdge.body.workspace.discussionEdges[0];
    expect(edge).toMatchObject({ source: 'information-architecture', target: node.id, relation: 'related-to', label: '实验关联' });
    await request(app).delete(`/api/graph/edges/${edge.id}`).expect(200);
    await request(app).delete(`/api/graph/nodes/${node.id}`).expect(200);
    const workspace = await request(app).get('/api/workspace').expect(200);
    expect(workspace.body.workspace.discussionNodes).toHaveLength(2);
    expect(workspace.body.workspace.discussionNodes.find((item: { id: string }) => item.id === node.id)).toMatchObject({ status: 'archived' });
    expect(workspace.body.workspace.discussionEdges).toHaveLength(0);
  });

  it('runs temporary branch chat without persisting workspace state', async () => {
    const { app, filePath } = await testApp();
    await request(app).get('/api/workspace').expect(200);
    const before = await readFile(filePath, 'utf8');
    const response = await request(app).post('/api/temp-chat').send({ sourceNodeId: 'information-architecture', anchorText: '渐进式上下文', message: '为什么适合新用户？', history: [] }).expect(201);
    expect(response.body.assistantMessage).toMatchObject({ kind: 'assistant', text: '后端生成的回答' });
    expect(response.body.assistantMessage.nodeId).toBe('temp:information-architecture');
    expect(await readFile(filePath, 'utf8')).toBe(before);
  });

  it('keeps all messages and manifests across 100 ordinary conversation rounds', async () => {
    const fastRuntime: AIRuntime = {
      kind: 'provider-adapter',
      listModels: async () => [{ id: 'model-1', provider: 'Load Test', model: 'load-model', displayName: 'Load Model', active: true }],
      async *generate(input) {
        yield { type: 'RUN_START', requestId: input.requestId, manifestId: input.manifestId, model: 'load-model', provider: 'Load Test' };
        yield { type: 'CONTENT_DELTA', requestId: input.requestId, delta: `回答:${input.prompt}` };
        yield { type: 'RUN_END', requestId: input.requestId, text: `回答:${input.prompt}`, model: 'load-model', provider: 'Load Test', usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 } };
      },
    };
    const { app } = await testApp(fastRuntime);
    for (let round = 1; round <= 100; round += 1) {
      await request(app).post('/api/chat').send({ message: `第 ${round} 轮` }).expect(201);
    }
    const snapshot = await request(app).get('/api/workspace').expect(200);
    expect(snapshot.body.workspace.messages).toHaveLength(202);
    expect(snapshot.body.workspace.manifests).toHaveLength(100);
    expect(new Set(snapshot.body.workspace.messages.map((message: { id: string }) => message.id)).size).toBe(202);
    expect(snapshot.body.workspace.messages.slice(-2).map((message: { text: string }) => message.text)).toEqual(['第 100 轮', '回答:第 100 轮']);
  });

  it('creates traceable Edit & Resend and Regenerate event versions without overwriting history', async () => {
    const { app } = await testApp();
    const first = await request(app).post('/api/chat').send({ message: '原始版本' }).expect(201);
    const edited = await request(app).post('/api/chat').send({ message: '编辑后的版本', operation: 'edit-resend', sourceMessageId: first.body.userMessage.id }).expect(201);
    const regenerated = await request(app).post('/api/chat').send({ message: '服务端会忽略此占位文本', operation: 'regenerate', sourceMessageId: edited.body.assistantMessage.id }).expect(201);

    expect(edited.body.userMessage).toMatchObject({ text: '编辑后的版本', operation: 'edit-resend', sourceMessageId: first.body.userMessage.id, version: 2, versionGroupId: first.body.userMessage.id });
    expect(regenerated.body.userMessage).toMatchObject({ text: '编辑后的版本', operation: 'regenerate', sourceMessageId: edited.body.assistantMessage.id, version: 3, versionGroupId: first.body.userMessage.id });
    const snapshot = await request(app).get('/api/workspace').expect(200);
    expect(snapshot.body.workspace.messages.map((message: { text: string }) => message.text)).toEqual(expect.arrayContaining(['原始版本', '编辑后的版本']));
    expect(snapshot.body.workspace.messages.filter((message: { versionGroupId?: string }) => message.versionGroupId === first.body.userMessage.id)).toHaveLength(6);
    expect(snapshot.body.workspace.manifests.slice(-2).map((manifest: { operation: string }) => manifest.operation)).toEqual(['edit-resend', 'regenerate']);
  });

  it('uploads a text attachment, displays its metadata and includes its content in the provider call', async () => {
    const { app, fetcher } = await testApp();
    const uploaded = await request(app).post('/api/attachments').send({ name: 'brief.txt', mimeType: 'text/plain', dataBase64: Buffer.from('附件中的验收约束').toString('base64') }).expect(201);
    expect(uploaded.body.attachment).toMatchObject({ name: 'brief.txt', mimeType: 'text/plain', kind: 'file' });
    expect(uploaded.body.attachment).not.toHaveProperty('extractedText');
    const turn = await request(app).post('/api/chat').send({ message: '总结附件', attachmentIds: [uploaded.body.attachment.id], generation: { temperature: 0.2, topP: 0.8, maxTokens: 512 } }).expect(201);
    expect(turn.body.userMessage.attachmentIds).toEqual([uploaded.body.attachment.id]);
    expect(turn.body.manifest).toMatchObject({ attachmentIds: [uploaded.body.attachment.id], generation: { temperature: 0.2, topP: 0.8, maxTokens: 512 } });
    expect(turn.body.manifest.contextItems).toEqual(expect.arrayContaining([expect.objectContaining({ sourceType: 'chunk', selectionMode: 'USER_SELECTED', reason: expect.stringContaining('本轮显式附加文件') })]));
    expect(turn.body.manifest.planner).toMatchObject({ fallback: false, candidateCount: expect.any(Number) });
    const payload = JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body));
    expect(payload).toMatchObject({ temperature: 0.2, top_p: 0.8, max_tokens: 512 });
    expect(payload.messages.at(-1).content).toContain('brief.txt');
    expect(payload.messages.at(-1).content).toContain('附件中的验收约束');
  });

  it('runs three provider profiles through the same Runtime contract', async () => {
    const { app, fetcher } = await testApp();
    await request(app).get('/api/providers').expect(200);
    await request(app).post('/api/providers').send({ preset: 'deepseek', name: 'DeepSeek', baseUrl: 'https://deepseek.test/v1', apiKey: 'key-2', allowNoKey: false, modelId: 'deepseek-chat' }).expect(201);
    await request(app).post('/api/providers').send({ preset: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.test/v1', apiKey: 'key-3', allowNoKey: false, modelId: 'openrouter-model' }).expect(201);
    const catalog = (await request(app).get('/api/providers').expect(200)).body.catalog;
    expect(catalog.providers).toHaveLength(3);
    for (const model of catalog.models) {
      await request(app).post(`/api/models/${model.id}/select`).expect(200);
      await request(app).post('/api/chat').send({ message: `profile:${model.modelId}` }).expect(201);
    }
    const models = fetcher.mock.calls.slice(-3).map(call => JSON.parse(String(call[1]?.body)).model);
    expect(new Set(models)).toEqual(new Set(['test-model', 'deepseek-chat', 'openrouter-model']));
  });
});
