// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { collectRuntimeResult } from './ai-runtime';
import { ProviderRuntime } from './provider-runtime';
import type { ProviderService } from './provider-service';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderService as CatalogService } from './provider-service';
import { ProviderStore } from './provider-store';
import { SecretVault } from './secret-vault';

describe('ProviderRuntime', () => {
  it('keeps existing model/endpoint IDs stable and refuses a changed endpoint before resolving its credentials', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-model-identity-'));
    try {
      const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: 'answer' } }] }), { headers: { 'Content-Type': 'application/json' } }));
      const providers = new CatalogService(new ProviderStore(join(directory, 'providers.json')), new SecretVault(join(directory, 'key')), { baseUrl: 'https://one.test/v1', apiKey: 'secret', model: 'shared', providerName: 'One', chatPath: '/chat/completions', timeoutMs: 1000, temperature: 0.4, extraHeaders: {}, allowNoKey: false }, fetcher);
      await providers.snapshot();
      await providers.saveProvider({ preset: 'custom', name: 'Two', baseUrl: 'https://two.test/v1', modelId: 'shared', apiKey: 'secret-two', allowNoKey: false });
      const runtime = new ProviderRuntime(providers);
      const models = await runtime.listModels();
      expect(models).toHaveLength(2);
      expect(new Set(models.map(model => model.id)).size).toBe(2);
      expect(new Set(models.map(model => model.providerEndpointRef)).size).toBe(2);
      expect(await runtime.listModels()).toEqual(models);
      const frozen = models.find(model => model.provider === 'One')!;
      await providers.saveProvider({ preset: 'custom', name: 'Renamed', baseUrl: 'https://changed.test/v1', allowNoKey: false }, frozen.providerEndpointRef);
      await expect(collectRuntimeResult(runtime, { requestId: 'request', manifestId: 'manifest', projectId: 'workspace', nodeId: 'node', modelId: frozen.id, modelSnapshot: frozen, prompt: 'hello', history: [], contextItems: [], mode: 'Strict' })).rejects.toMatchObject({ code: 'PROVIDER_CONFIGURATION_CHANGED' });
      expect(fetcher).not.toHaveBeenCalled();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('maps a frozen Rhiza request onto the runtime event protocol', async () => {
    const providers = {
      snapshot: vi.fn().mockResolvedValue({
        providers: [{ id: 'provider-1', name: 'Test Provider' }],
        models: [{ id: 'model-1', providerId: 'provider-1', modelId: 'test-model', displayName: 'Test Model' }],
        activeModelId: 'model-1',
      }),
      streamModel: vi.fn().mockImplementation(async () => ({
        stream: (async function* () {
          yield { type: 'reasoning', delta: '先检查约束' };
          yield { type: 'tool', toolCall: { id: 'tool-1', name: 'search', arguments: '{"q":' } };
          yield { type: 'tool', toolCall: { id: 'tool-1', name: '', arguments: '"Rhiza"}' } };
          yield { type: 'content', delta: '运行时' };
          yield { type: 'content', delta: '回答' };
          yield { type: 'usage', usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 } };
        })(),
        model: 'test-model', provider: 'Test Provider',
      })),
    } as unknown as ProviderService;
    const runtime = new ProviderRuntime(providers);
    const request = {
      requestId: 'request-1', manifestId: 'manifest-1', projectId: 'project-1', nodeId: 'node-1', modelId: 'model-1',
      prompt: '继续分析', history: [], contextItems: [], mode: 'Assisted' as const,
    };

    const events = [];
    for await (const event of runtime.generate(request)) events.push(event);

    expect(events.map(event => event.type)).toEqual(['RUN_START', 'REASONING_DELTA', 'TOOL_CALL_DELTA', 'TOOL_CALL_DELTA', 'CONTENT_DELTA', 'CONTENT_DELTA', 'USAGE', 'RUN_END']);
    expect(events[0]).toMatchObject({ manifestId: 'manifest-1', model: 'test-model', provider: 'Test Provider' });
    expect(await collectRuntimeResult(runtime, request)).toMatchObject({ text: '运行时回答', model: 'test-model', provider: 'Test Provider', reasoning: '先检查约束', toolCalls: [{ id: 'tool-1', name: 'search', arguments: '{"q":"Rhiza"}' }], usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 } });
    expect(providers.streamModel).toHaveBeenCalledWith('model-1', expect.objectContaining({ nodeId: 'node-1', manifestId: 'manifest-1' }));
  });
});
