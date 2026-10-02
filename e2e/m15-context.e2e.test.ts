// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { expect, it } from 'vitest';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { createApp } from '../server/app';
import { ProviderService } from '../server/provider-service';
import { ProviderStore } from '../server/provider-store';
import { SecretVault } from '../server/secret-vault';
import type { AIRuntime, RuntimeRequest } from '../server/ai-runtime';

it('M15 persists version-bound decisions, keeps preview read-only and checks scoped membership', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m15-context-'));
  const store = await openEmbeddedWorkspaceStore(join(root, 'db'));
  try {
    const provider = new ProviderService(new ProviderStore(join(root, 'providers')), new SecretVault(join(root, 'key')), { baseUrl: 'https://example.test', apiKey: '', model: 'fixture', providerName: 'Fixture', chatPath: '/chat', timeoutMs: 1000, temperature: 0, extraHeaders: {}, allowNoKey: true });
    const calls: RuntimeRequest[] = [];
    const runtime: AIRuntime = {
      kind: 'provider-adapter', listModels: async () => [{ id: 'fixture', model: 'fixture', provider: 'Fixture', displayName: 'Fixture', active: true }],
      async *generate(input) { calls.push(input); yield { type: 'RUN_START', requestId: input.requestId, manifestId: input.manifestId, model: 'fixture', provider: 'Fixture' }; yield { type: 'RUN_END', requestId: input.requestId, text: 'Answer', model: 'fixture', provider: 'Fixture' }; },
    };
    const app = createApp(store, provider, false, runtime, undefined, join(root, 'uploads'));
    await request(app).get('/api/workspace').expect(200);
    const created = await request(app).post('/api/graph/nodes').send({ title: 'Payment evidence', summary: 'payment idempotency' }).expect(201);
    const node = created.body.workspace.discussionNodes.find((node: { title: string }) => node.title === 'Payment evidence');
    const events = (await request(app).get('/api/workspace/activity').expect(200)).body;
    const preview = await request(app).get('/api/workspace/context/preview').query({ query: 'payment' }).expect(200);
    expect((await request(app).get('/api/workspace/activity').expect(200)).body).toEqual(events);
    const recommendation = preview.body.recommendations.find((item: { sourceId: string }) => item.sourceId === node.id);
    expect(recommendation.sourceRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(calls).toEqual([]);
    const unconfirmed = await request(app).post('/api/chat').send({ message: 'payment' }).expect(201);
    expect(unconfirmed.body.manifest.contextItems.some((item: { sourceId: string }) => item.sourceId === node.id)).toBe(false);
    expect(calls[0].contextItems.some(item => item.sourceId === node.id)).toBe(false);
    const decision = { sourceType: 'node', sourceId: node.id, sourceRevision: recommendation.sourceRevision, decision: 'accept', reason: 'Relevant evidence' };
    await request(app).post('/api/workspace/context/decisions').set('Idempotency-Key', 'm15-accept').send(decision).expect(200);
    await request(app).post('/api/workspace/context/decisions').set('Idempotency-Key', 'm15-accept').send(decision).expect(200);
    const workspace = await store.read();
    const accepted = workspace.contextItems.filter(item => item.sourceId === node.id);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ sourceRevision: recommendation.sourceRevision, reason: 'Relevant evidence', selectionMode: 'AI_RECOMMENDED_ACCEPTED' });
    const confirmed = await request(app).post('/api/chat').send({ message: 'payment' }).expect(201);
    expect(confirmed.body.manifest.contextItems).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: node.id, selectionMode: 'AI_RECOMMENDED_ACCEPTED', reason: 'Relevant evidence' })]));
    await request(app).patch(`/api/nodes/${node.id}/title`).send({ title: 'Payment evidence revised' }).expect(200);
    const stale = await request(app).get('/api/workspace/context/preview').query({ query: 'payment' }).expect(409);
    expect(stale.body.error.code).toBe('CONTEXT_SELECTION_STALE');
    await request(app).get('/api/v1/workspaces/10000000-0000-4000-8000-000000000099/workspace/context/preview').query({ query: 'payment' }).expect(403);
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});
