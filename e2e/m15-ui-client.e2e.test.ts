// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { api } from '../src/api';
import { createApp } from '../server/app';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { ProviderService } from '../server/provider-service';
import { ProviderStore } from '../server/provider-store';
import { SecretVault } from '../server/secret-vault';
import type { AIRuntime, RuntimeRequest } from '../server/ai-runtime';

it('connects the UI client through scoped HTTP selection, frozen provenance and guarded Replay without dispatching during inspection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m15-ui-client-'));
  const store = await openEmbeddedWorkspaceStore(join(root, 'db'));
  const calls: RuntimeRequest[] = [];
  const provider = new ProviderService(new ProviderStore(join(root, 'providers')), new SecretVault(join(root, 'key')), { baseUrl: 'https://example.test', apiKey: '', model: 'fixture', providerName: 'Fixture', chatPath: '/chat', timeoutMs: 1000, temperature: 0, extraHeaders: {}, allowNoKey: true });
  const runtime: AIRuntime = {
    kind: 'provider-adapter', listModels: async () => [{ id: 'fixture', model: 'fixture', provider: 'Fixture', displayName: 'Fixture', active: true }],
    async *generate(input) {
      calls.push(input);
      yield { type: 'RUN_START', requestId: input.requestId, manifestId: input.manifestId, model: 'fixture', provider: 'Fixture' };
      yield { type: 'RUN_END', requestId: input.requestId, text: 'Offline answer', model: 'fixture', provider: 'Fixture' };
    },
  };
  const app = createApp(store, provider, false, runtime, undefined, join(root, 'uploads'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const nativeFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => nativeFetch(`${origin}${path}`, init));
  try {
    api.setWorkspace();
    const { workspace } = await api.getWorkspace();
    api.setWorkspace(workspace.projectId);
    const { workspace: created } = await api.createGraphNode({ title: 'Payment evidence', summary: 'payment idempotency', x: 100, y: 100 });
    const source = created.discussionNodes.find(node => node.title === 'Payment evidence')!;
    const before = await api.getWorkspaceActivity();
    const preview = await api.getContextPreview('payment');
    const recommended = preview.recommendations.find(item => item.sourceId === source.id)!;
    expect(recommended.sourceRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(await api.getWorkspaceActivity()).toEqual(before);
    expect(calls).toHaveLength(0);
    const decision = { sourceType: 'node' as const, sourceId: source.id, sourceRevision: recommended.sourceRevision!, decision: 'accept' as const, reason: '本轮采用这份证据' };
    await api.decideContextRecommendation(decision, 'reviewed-selection');
    await api.decideContextRecommendation(decision, 'reviewed-selection');
    expect((await api.getContextPreview('payment')).items.filter(item => item.sourceId === source.id)).toHaveLength(1);
    expect(calls).toHaveLength(0);

    const turn = await api.sendMessage('payment');
    const provenance = await api.getProvenance(turn.assistantMessage.id);
    const history = await api.getManifestContext(provenance.contextManifestRef!);
    expect(history).toEqual(await api.getMessageContext(turn.assistantMessage.id));
    expect(history.manifest.contextItems).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: source.id, selectionMode: 'AI_RECOMMENDED_ACCEPTED', reason: decision.reason })]));
    expect(history.sources.every(item => item.status === 'resolved')).toBe(true);
    const preflight = await api.getReplayPreflight(provenance.runRef!);
    expect(preflight.policies.find(item => item.policy === 'exact')).toMatchObject({ allowed: true });
    expect(calls).toHaveLength(1);
    await api.replayRun(provenance.runRef!, 'exact', 'explicit-replay');
    await api.replayRun(provenance.runRef!, 'exact', 'explicit-replay');
    expect(calls).toHaveLength(2);
    expect(await api.getManifestContext(provenance.contextManifestRef!)).toEqual(history);

    await api.renameConversation(source.id, 'Payment evidence changed');
    await expect(api.decideContextRecommendation(decision, 'stale-review')).rejects.toMatchObject({ code: 'CONTEXT_SELECTION_STALE', status: 409 });
    expect(calls).toHaveLength(2);
  } finally {
    api.setWorkspace(); vi.unstubAllGlobals();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await store.close(); await rm(root, { recursive: true, force: true });
  }
}, 30000);
