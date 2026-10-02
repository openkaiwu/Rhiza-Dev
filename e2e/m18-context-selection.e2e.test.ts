// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { expect, it } from 'vitest';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { NodeEncryptedBlobStore } from '../server/infrastructure/node-encrypted-blob-store';
import { createApp } from '../server/app';
import { ProviderService } from '../server/provider-service';
import { ProviderStore } from '../server/provider-store';
import { SecretVault } from '../server/secret-vault';
import type { RuntimeRequest } from '../server/ai-runtime';
import type { SqlQueryable } from '../server/postgres-store';
import type { ContextSelectionPreview } from '../server/contracts/context-selection';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m18-context-'));
  const uploads = join(root, 'uploads');
  const store = await openEmbeddedWorkspaceStore(join(root, 'db'), undefined, 'apply', NodeEncryptedBlobStore.atDirectory(uploads));
  const provider = new ProviderService(new ProviderStore(join(root, 'providers')), new SecretVault(join(root, 'key')), {
    baseUrl: 'https://example.test', apiKey: '', model: 'fixture', providerName: 'Fixture', chatPath: '/chat', timeoutMs: 1000, temperature: 0, extraHeaders: {}, allowNoKey: true,
  });
  const calls: RuntimeRequest[] = [];
  const app = createApp(store, provider, false, {
    kind: 'provider-adapter', listModels: async () => [{ id: 'fixture', model: 'fixture', provider: 'Fixture', displayName: 'Fixture', active: true }],
    async *generate(input) { calls.push(input); yield { type: 'RUN_END', requestId: input.requestId, text: 'Selected sources applied', model: 'fixture', provider: 'Fixture' }; },
  }, undefined, uploads);
  await request(app).get('/api/workspace').expect(200);
  await request(app).patch('/api/workspace/mode').send({ mode: 'Strict' }).expect(200);
  return { app, store, calls, database: (store as unknown as { database: SqlQueryable }).database,
    dispose: async () => { await store.close(); await rm(root, { recursive: true, force: true }); } };
}
const confirmInput = (preview: ContextSelectionPreview) => ({ expectedNodeId: preview.expectedNodeId,
  sources: preview.sources.map(({ sourceType, sourceId, sourceRevision }) => ({ sourceType, sourceId, sourceRevision })) });

it('M18 confirms reviewed node and Segment sources atomically, freezes the exact next Manifest and preserves earlier history without duplicate dispatch', async () => {
  const { app, store, calls, dispose } = await fixture();
  try {
    const old = (await request(app).post('/api/chat').send({ message: 'Before graph selection' }).expect(201)).body;
    const oldHistory = (await request(app).get(`/api/context/manifests/${old.manifest.id}`).expect(200)).body;
    const created = (await request(app).post('/api/graph/nodes').send({ title: 'Reviewed evidence', summary: 'Exact reviewed facts' }).expect(201)).body.workspace;
    const nodeId = created.discussionNodes.find((node: { title: string }) => node.title === 'Reviewed evidence').id;
    const initial = await store.read();
    const message = initial.messages.find(message => message.nodeId === initial.activeNodeId)!;
    const segment = (await request(app).post(`/api/nodes/${initial.activeNodeId}/segments`).send({ title: 'Exact selected excerpt', messageIds: [message.id],
      range: { messageId: message.id, startOffset: 0, endOffset: 3, selectedText: message.text.slice(0, 3) } }).expect(201)).body.segment;
    const sources = [{ sourceType: 'node', sourceId: nodeId }, { sourceType: 'segment', sourceId: segment.id }];
    const activityBefore = (await request(app).get('/api/workspace/activity').expect(200)).body;
    const preview = (await request(app).post('/api/workspace/context/selection/preview').send({ sources }).expect(200)).body as ContextSelectionPreview;
    expect(preview).toMatchObject({ workspaceId: initial.projectId, expectedNodeId: initial.activeNodeId, status: 'ready', overBudget: false });
    expect(preview.sources.map(source => [source.sourceType, source.sourceId])).toEqual(sources.map(source => [source.sourceType, source.sourceId]));
    expect((await request(app).get('/api/workspace/activity').expect(200)).body).toEqual(activityBefore);
    expect(calls).toHaveLength(1);
    const confirmed = (await request(app).post('/api/workspace/context/selection').set('Idempotency-Key', 'reviewed-batch').send(confirmInput(preview)).expect(201)).body.workspace;
    expect(confirmed.contextItems.filter((item: { sourceRevision?: string; selectionMode: string }) => item.selectionMode === 'USER_SELECTED' && item.sourceRevision)).toHaveLength(2);
    const activityCommitted = (await request(app).get('/api/workspace/activity').expect(200)).body;
    const repeated = (await request(app).post('/api/workspace/context/selection').set('Idempotency-Key', 'reviewed-batch').send(confirmInput(preview)).expect(201)).body.workspace;
    expect(repeated).toEqual(confirmed);
    expect((await request(app).get('/api/workspace/activity').expect(200)).body).toEqual(activityCommitted);
    expect(calls).toHaveLength(1);
    const executed = (await request(app).post('/api/chat').set('Idempotency-Key', 'selected-chat').send({ message: 'Use this reviewed group' }).expect(201)).body;
    const history = (await request(app).get(`/api/context/manifests/${executed.manifest.id}`).expect(200)).body;
    for (const source of preview.sources) {
      const index = executed.manifest.contextItems.findIndex((item: { sourceType: string; sourceId: string }) => item.sourceType === source.sourceType && item.sourceId === source.sourceId);
      const reviewedItem = confirmed.contextItems.find((item: { sourceType: string; sourceId: string }) => item.sourceType === source.sourceType && item.sourceId === source.sourceId);
      expect(executed.manifest.contextItems[index]).toMatchObject({ selectionMode: 'USER_SELECTED' });
      expect(history.sources[index]).toMatchObject({ status: 'resolved', content: reviewedItem.content });
      expect(calls[1].contextItems.find(item => item.sourceId === source.sourceId)?.content).toBe(reviewedItem.content);
    }
    await request(app).post('/api/chat').set('Idempotency-Key', 'selected-chat').send({ message: 'Use this reviewed group' }).expect(201);
    expect(calls).toHaveLength(2);
    expect((await request(app).get(`/api/context/manifests/${old.manifest.id}`).expect(200)).body).toEqual(oldHistory);
    await request(app).patch(`/api/nodes/${nodeId}/title`).send({ title: 'Changed after review' }).expect(200);
    const beforeFailure = await store.read();
    expect((await request(app).post('/api/chat').send({ message: 'Do not silently substitute changed evidence' }).expect(409)).body.error.code).toBe('CONTEXT_SELECTION_STALE');
    expect((await store.read()).manifests).toEqual(beforeFailure.manifests);
    expect((await store.read()).messages).toEqual(beforeFailure.messages);
    expect(calls).toHaveLength(2);
  } finally { await dispose(); }
}, 30_000);

it('M18 rejects wrong target, stale/foreign/archived sources and budget overflow, and rolls back a failed whole-group publication', async () => {
  const { app, store, calls, database, dispose } = await fixture();
  try {
    const before = await store.read();
    const created = (await request(app).post('/api/graph/nodes').send({ title: 'First selected source', summary: 'Small source' }).expect(201)).body.workspace;
    const nodeId = created.discussionNodes.find((node: { title: string }) => node.title === 'First selected source').id;
    const sources = [{ sourceType: 'node', sourceId: nodeId }, { sourceType: 'segment', sourceId: before.segments[0].id }];
    const preview = (await request(app).post('/api/workspace/context/selection/preview').send({ sources }).expect(200)).body as ContextSelectionPreview;
    const input = confirmInput(preview), untouched = (await store.read()).contextItems;
    expect((await request(app).post('/api/workspace/context/selection').send({ ...input, expectedNodeId: nodeId }).expect(409)).body.error.code).toBe('CONTEXT_TARGET_CHANGED');
    expect((await request(app).post('/api/workspace/context/selection').send({ ...input, sources: input.sources.map((source, index) => index ? { ...source, sourceRevision: 'a'.repeat(64) } : source) }).expect(409)).body.error.code).toBe('CONTEXT_SELECTION_STALE');
    expect((await store.read()).contextItems).toEqual(untouched);
    await request(app).post('/api/workspace/context/selection/preview').send({ sources: [{ sourceType: 'message', sourceId: before.messages[0].id }] }).expect(400);
    await request(app).post('/api/workspace/context/selection/preview').send({ sources: [sources[0], sources[0]] }).expect(400);
    const other = (await request(app).post('/api/v1/workspaces').send({ name: 'Foreign workspace' }).expect(201)).body.workspace.workspaceId;
    const foreignWorkspace = (await request(app).post(`/api/v1/workspaces/${other}/graph/nodes`).send({ title: 'Foreign source' }).expect(201)).body.workspace;
    const foreignId = foreignWorkspace.discussionNodes.find((node: { title: string }) => node.title === 'Foreign source').id;
    expect((await request(app).post('/api/workspace/context/selection/preview').send({ sources: [{ sourceType: 'node', sourceId: foreignId }] }).expect(409)).body.error.code).toBe('CONTEXT_SOURCE_NOT_FOUND');
    await request(app).post('/api/workspace/context/selection').send({ ...input, sources: [input.sources[0], { sourceType: 'node', sourceId: foreignId, sourceRevision: 'a'.repeat(64) }] }).expect(409);
    await request(app).post(`/api/v1/workspaces/${other}/workspace/context/selection`).send(input).expect(409);
    await request(app).post('/api/v1/workspaces/10000000-0000-4000-8000-000000000099/workspace/context/selection/preview').send({ sources }).expect(403);
    await request(app).delete(`/api/graph/nodes/${nodeId}`).expect(200);
    await request(app).post('/api/workspace/context/selection/preview').send({ sources }).expect(409);
    await request(app).post('/api/workspace/context/selection').send(input).expect(409);
    expect((await store.read()).contextItems).toEqual(untouched);
    expect(calls).toEqual([]);

    // A source can be large even though individual HTTP messages remain bounded.
    const large = (await request(app).post('/api/nodes').send({ title: 'Capacity source', anchorText: 'Capacity source',
      messages: Array.from({ length: 7 }, () => ({ kind: 'user', text: 'x'.repeat(20_000) })) }).expect(201)).body.workspace;
    const largeNodeId = large.activeNodeId;
    const excessive = (await request(app).post('/api/workspace/context/selection/preview').send({ sources: [{ sourceType: 'node', sourceId: largeNodeId }] }).expect(200)).body as ContextSelectionPreview;
    expect(excessive).toMatchObject({ status: 'over_budget', overBudget: true });
    const beforeBudget = (await store.read()).contextItems;
    expect((await request(app).post('/api/workspace/context/selection').send(confirmInput(excessive)).expect(409)).body.error.code).toBe('CONTEXT_BUDGET_EXCEEDED');
    expect((await store.read()).contextItems).toEqual(beforeBudget); expect(calls).toEqual([]);

    const small = (await request(app).post('/api/graph/nodes').send({ title: 'Retry after SQL failure' }).expect(201)).body.workspace;
    const smallId = small.discussionNodes.find((node: { title: string }) => node.title === 'Retry after SQL failure').id;
    // Restore the small original execution discussion before preparing a group.
    await request(app).post(`/api/nodes/${before.activeNodeId}/activate`).expect(200);
    const retry = (await request(app).post('/api/workspace/context/selection/preview').send({ sources: [{ sourceType: 'node', sourceId: smallId }, sources[1]] }).expect(200)).body as ContextSelectionPreview;
    const current = await store.read(), events = (await database.query('SELECT event_id FROM workspace_events ORDER BY sequence')).rows;
    // Fail Journal publication so rollback must cover the entire Context group.
    await database.query("CREATE FUNCTION fail_m18_context() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='context.selection.changed' THEN RAISE EXCEPTION 'injected Context selection write failure'; END IF; RETURN NEW; END $$");
    await database.query('CREATE TRIGGER fail_m18_context BEFORE INSERT ON workspace_events FOR EACH ROW EXECUTE FUNCTION fail_m18_context()');
    await request(app).post('/api/workspace/context/selection').set('Idempotency-Key', 'context-storage-failure').send(confirmInput(retry)).expect(500);
    expect((await store.read()).contextItems).toEqual(current.contextItems);
    expect((await database.query('SELECT event_id FROM workspace_events ORDER BY sequence')).rows).toEqual(events);
    expect(calls).toEqual([]);
    await database.query('DROP TRIGGER fail_m18_context ON workspace_events');
    await request(app).post('/api/workspace/context/selection').set('Idempotency-Key', 'context-after-storage-failure').send(confirmInput(retry)).expect(201);
    expect((await store.read()).contextItems.filter(item => [smallId, sources[1].sourceId].includes(item.sourceId ?? '') && item.sourceRevision)).toHaveLength(2);
    expect(calls).toEqual([]);
  } finally { await dispose(); }
}, 30_000);
