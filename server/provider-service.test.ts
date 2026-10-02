// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { ProviderService } from './provider-service';
import { ProviderStore } from './provider-store';
import { SecretVault } from './secret-vault';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function fixture(timeoutMs = 1000) {
  const directory = await mkdtemp(join(tmpdir(), 'rhiza-provider-catalog-'));
  directories.push(directory);
  const path = join(directory, 'providers.json');
  const store = new ProviderStore(path);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'discovered' }] })));
  const service = new ProviderService(store, new SecretVault(join(directory, 'key')), {
    baseUrl: 'https://provider.test/v1', apiKey: 'private-fixture-credential', model: 'manual', providerName: 'Fixture',
    chatPath: '/chat/completions', timeoutMs, temperature: 0.4, extraHeaders: {}, allowNoKey: false,
  }, fetcher);
  const snapshot = await service.snapshot();
  return { service, store, fetcher, path, provider: snapshot.providers[0], model: snapshot.models[0] };
}

it('persists safe version-bound discovery health without changing endpoint identity or exposing upstream secrets', async () => {
  const { service, provider, fetcher, path } = await fixture();
  fetcher.mockResolvedValueOnce(new Response('private-fixture-credential upstream body', { status: 401 }));
  await expect(service.discoverModels(provider.id)).rejects.toMatchObject({ code: 'PROVIDER_INVALID_KEY' });
  let snapshot = await service.snapshot();
  expect(snapshot.providers[0]).toMatchObject({ configured: true, updatedAt: provider.updatedAt,
    discoveryHealth: { status: 'invalid-key', code: 'PROVIDER_INVALID_KEY', endpointVersion: provider.updatedAt } });
  expect(JSON.stringify(snapshot)).not.toContain('private-fixture-credential');
  expect(await readFile(path, 'utf8')).not.toContain('private-fixture-credential');
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'new-model' }, { id: 'new-model' }] })));
  snapshot = await service.discoverModels(provider.id);
  expect(snapshot.providers[0]).toMatchObject({ updatedAt: provider.updatedAt, discoveryHealth: { status: 'healthy', code: 'MODEL_DISCOVERY_OK', discoveredCount: 1 } });
  expect(snapshot.models.filter(model => model.modelId === 'new-model')).toHaveLength(1);
  expect(JSON.parse(await readFile(path, 'utf8')).providers[0].discoveryHealth.status).toBe('healthy');
});

it('keeps manual Chat working after discovery is unavailable and bounds stalled responses', async () => {
  const { service, provider, model, fetcher } = await fixture(20);
  fetcher.mockResolvedValueOnce(new Response('', { status: 404 }));
  await expect(service.discoverModels(provider.id)).rejects.toMatchObject({ code: 'MODEL_DISCOVERY_UNSUPPORTED' });
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'manual answer' } }] })));
  expect(await service.completeModel(model.id, { prompt: 'hello', history: [], contextItems: [], mode: 'Auto' })).toMatchObject({ text: 'manual answer' });
  fetcher.mockImplementationOnce(async () => new Promise<Response>(() => undefined));
  await expect(service.discoverModels(provider.id)).rejects.toMatchObject({ code: 'MODEL_DISCOVERY_TIMEOUT' });
  expect(fetcher.mock.calls.at(-1)?.[1]?.signal?.aborted).toBe(true);
  expect((await service.snapshot()).providers[0].discoveryHealth?.status).toBe('degraded');
});

it('rejects malformed catalogs atomically and records fixed codes for missing credentials, rate limits and network errors', async () => {
  const { service, provider, fetcher, store } = await fixture();
  for (const [response, code] of [
    [new Response(JSON.stringify({ data: [{ id: 'partial' }, { id: 123 }] })), 'MODEL_DISCOVERY_INVALID_RESPONSE'],
    [new Response('private-fixture-credential', { status: 429 }), 'MODEL_DISCOVERY_RATE_LIMITED'],
    [new Response('private-fixture-credential', { status: 503 }), 'MODEL_DISCOVERY_FAILED'],
  ] as const) {
    fetcher.mockResolvedValueOnce(response);
    await expect(service.discoverModels(provider.id)).rejects.toMatchObject({ code });
    expect((await service.snapshot()).models).toHaveLength(1);
  }
  fetcher.mockRejectedValueOnce(new Error('private-fixture-credential'));
  await expect(service.discoverModels(provider.id)).rejects.toMatchObject({ code: 'MODEL_DISCOVERY_NETWORK' });
  await store.update(data => { delete data.providers[0].apiKey; return data; });
  await expect(service.discoverModels(provider.id)).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
  expect((await service.snapshot()).providers[0].discoveryHealth?.status).toBe('unconfigured');
});

it('deduplicates concurrent refreshes and discards stale results after saving new endpoint settings', async () => {
  const { service, provider, fetcher } = await fixture();
  let release!: (response: Response) => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  fetcher.mockImplementationOnce(async () => { started(); return new Promise(resolve => { release = resolve; }); });
  const first = service.discoverModels(provider.id);
  const repeated = service.discoverModels(provider.id);
  const outcomes = Promise.allSettled([first, repeated]);
  await ready;
  const saved = await service.saveProvider({ preset: 'custom', name: 'Changed', baseUrl: 'https://new.test/v1', allowNoKey: true }, provider.id);
  expect(saved.providers[0].updatedAt).not.toBe(provider.updatedAt);
  release(new Response(JSON.stringify({ data: [{ id: 'stale-model' }] })));
  expect((await outcomes).map(result => result.status === 'rejected' && result.reason.code)).toEqual(['PROVIDER_CONFIGURATION_CHANGED', 'PROVIDER_CONFIGURATION_CHANGED']);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const current = await service.snapshot();
  expect(current.models.map(model => model.modelId)).not.toContain('stale-model');
  expect(current.providers[0].discoveryHealth?.status).toBe('unknown');
  // A rejected store mutation must not poison all later saves/retries.
  await expect(service.selectModel('missing')).rejects.toMatchObject({ code: 'MODEL_NOT_FOUND' });
  await expect(service.discoverModels(provider.id)).resolves.toMatchObject({ providers: [expect.objectContaining({ discoveryHealth: expect.objectContaining({ status: 'healthy' }) })] });
});

it('returns per-provider batch outcomes and retries only failed endpoints without repeating healthy calls', async () => {
  const { service, provider, fetcher } = await fixture();
  const saved = await service.saveProvider({ preset: 'custom', name: 'Second', baseUrl: 'https://second.test/v1', allowNoKey: true, modelId: 'second' });
  const second = saved.providers.find(item => item.id !== provider.id)!;
  fetcher.mockImplementation(async url => String(url).includes('second.test') ? new Response('', { status: 403 }) : new Response(JSON.stringify({ data: [] })));
  const result = await service.discoverBatch({ providerIds: [provider.id, second.id] });
  expect(result.results).toEqual([
    { providerId: provider.id, status: 'succeeded' },
    { providerId: second.id, status: 'failed', code: 'PROVIDER_INVALID_KEY' },
  ]);
  fetcher.mockClear().mockImplementation(async () => new Response(JSON.stringify({ data: [] })));
  const retried = await service.discoverBatch({ providerIds: [provider.id, second.id], failedOnly: true });
  expect(retried.results.map(item => item.status)).toEqual(['skipped', 'succeeded']);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toContain('second.test');
  fetcher.mockClear();
  await expect(service.discoverBatch({ providerIds: [provider.id, 'missing'] })).rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND' });
  expect(fetcher).not.toHaveBeenCalled();
  await expect(service.discoverBatch({ providerIds: [provider.id, provider.id] })).rejects.toMatchObject({ code: 'INVALID_PROVIDER_BATCH' });
});

it('filters and orders catalog reads without changing active selection, saved preferences or endpoint health', async () => {
  const { service, provider, store, path } = await fixture();
  await store.update(data => { data.models.push(
    { ...data.models[0], id: 'z', modelId: 'z', displayName: 'Zulu', pinned: true },
    { ...data.models[0], id: 'a', modelId: 'alpha', displayName: 'Alpha', favorite: true },
  ); return data; });
  const before = await readFile(path, 'utf8');
  expect((await service.snapshot({ search: 'ALP', providerId: provider.id, favorite: true })).models.map(model => model.id)).toEqual(['a']);
  expect((await service.snapshot({ sort: 'name' })).models.map(model => model.id)).toEqual(['a', (await service.snapshot()).activeModelId, 'z']);
  expect((await service.snapshot({ pinned: true })).models.map(model => model.id)).toEqual(['z']);
  expect((await service.snapshot({ search: 'nothing' })).activeModelId).not.toBeNull();
  await expect(service.snapshot({ sort: 'invalid' as 'name' })).rejects.toMatchObject({ code: 'INVALID_CATALOG_QUERY' });
  expect(await readFile(path, 'utf8')).toBe(before);
});

it('cancels a stalled catalog body at deadline and rejects oversized responses without adding models', async () => {
  const { service, provider, fetcher } = await fixture(20);
  const cancel = vi.fn();
  fetcher.mockResolvedValueOnce(new Response(new ReadableStream({ cancel })));
  await expect(service.discoverModels(provider.id)).rejects.toMatchObject({ code: 'MODEL_DISCOVERY_TIMEOUT' });
  expect(cancel).toHaveBeenCalledTimes(1);
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ data: [], padding: 'x'.repeat(2 * 1024 * 1024) })));
  await expect(service.discoverModels(provider.id)).rejects.toMatchObject({ code: 'MODEL_DISCOVERY_INVALID_RESPONSE' });
  expect((await service.snapshot()).models).toHaveLength(1);
});
