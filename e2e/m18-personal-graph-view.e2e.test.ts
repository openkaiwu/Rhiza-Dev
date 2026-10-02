// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect, it, vi } from 'vitest';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { createApp } from '../server/app';
import { ProviderService } from '../server/provider-service';
import { ProviderStore } from '../server/provider-store';
import { SecretVault } from '../server/secret-vault';
import { RepositoryWorkspaceUnitOfWork } from '../server/infrastructure/workspace-repository-unit-of-work';
import { semanticChecksum } from '../server/infrastructure/workspace-semantic-checksum';
import { LOCAL_USER_ID } from '../server/identity/workspace-scope';
import type { SqlQueryable } from '../server/postgres-store';

const actor = { actorType: 'human' as const, actorId: LOCAL_USER_ID };
function appFor(store: Awaited<ReturnType<typeof openEmbeddedWorkspaceStore>>, root: string) {
  const provider = new ProviderService(new ProviderStore(join(root, 'providers')), new SecretVault(join(root, 'key')), { baseUrl: 'https://example.test', apiKey: '', model: 'fixture', providerName: 'Fixture', chatPath: '/chat', timeoutMs: 1000, temperature: 0, extraHeaders: {}, allowNoKey: true });
  return createApp(store, provider, false, { kind: 'provider-adapter', listModels: async () => [], generate() { throw new Error('No model call expected'); } }, undefined, join(root, 'uploads'));
}

it('M18 persists actor/view-scoped metadata with receipts without changing shared graph, Journal or portable facts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m18-view-'));
  const store = await openEmbeddedWorkspaceStore(join(root, 'db'));
  try {
    const app = appFor(store, root); await request(app).get('/api/workspace').expect(200); await store.backfillJournal();
    const workspace = await store.read(); const endpoint = `/api/v1/workspaces/${workspace.projectId}/graph/views/conversation`;
    const before = semanticChecksum(workspace); const graph = await store.readGraphProjection();
    const facts = await store.readPortableWorkspace(); const journal = await store.readJournal();
    const initial = await request(app).get(endpoint).expect(200);
    expect(initial.body).toMatchObject({ source: 'default', revision: 0, viewType: 'conversation', ownerScope: { scopeType: 'user', scopeId: LOCAL_USER_ID } });
    expect(initial.body.positions).toContainEqual(expect.objectContaining({ objectType: 'conversation', objectId: workspace.activeNodeId }));
    const payload = { expectedRevision: 0, positions: [{ objectType: 'conversation' as const, objectId: workspace.activeNodeId, x: 730, y: 410, collapsed: true },
      ...workspace.messages.slice(0, 1).map(message => ({ objectType: 'message' as const, objectId: message.id, x: 210, y: 220, collapsed: false })),
      ...workspace.segments.slice(0, 1).map(segment => ({ objectType: 'segment' as const, objectId: segment.id, x: 310, y: 320, collapsed: false })),
    ], viewport: { x: -30, y: 40, zoom: 0.8 }, filters: { objectTypes: ['conversation'], relationTypes: ['references'] }, ownerId: randomUUID() };
    const saved = await request(app).put(endpoint).set('Idempotency-Key', 'personal-layout').send(payload).expect(200);
    expect(saved.body).toMatchObject({ revision: 1, ownerScope: { scopeId: LOCAL_USER_ID } });
    expect((await request(app).put(endpoint).set('Idempotency-Key', 'personal-layout').send(payload).expect(200)).body).toEqual(saved.body);
    await request(app).put(endpoint).set('Idempotency-Key', 'personal-layout').send({ ...payload, viewport: { x: 9, y: 9, zoom: 1 } }).expect(409);
    await request(app).put(endpoint).send(payload).expect(409);
    const current = (await request(app).get(endpoint).expect(200)).body;
    expect(current).toMatchObject({ source: 'personal', revision: 1, viewport: payload.viewport, filters: payload.filters });
    expect(current.positions).toContainEqual(payload.positions[0]);
    expect((await request(app).get(endpoint.replace('conversation', 'overview')).expect(200)).body).toMatchObject({ source: 'default', revision: 0 });
    const database = (store as unknown as { database: SqlQueryable }).database;
    const otherActor = { actorType: 'human' as const, actorId: randomUUID() };
    await database.query("INSERT INTO users(user_id,display_name) VALUES ($1,'Other fixture user')", [otherActor.actorId]);
    await database.query("INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'member')", [workspace.projectId, otherActor.actorId]);
    const uow = new RepositoryWorkspaceUnitOfWork(store);
    expect(await uow.readPersonalGraphView(otherActor, 'conversation')).toMatchObject({ source: 'default', revision: 0 });
    const otherContext = { commandId: randomUUID(), commandType: 'SavePersonalGraphView', actor: otherActor, scope: { scopeType: 'workspace' as const, scopeId: workspace.projectId }, occurredAt: new Date().toISOString() };
    await uow.withCommand(otherContext, () => uow.savePersonalGraphView({ ...payload, viewType: 'conversation', positions: [{ ...payload.positions[0], x: 120 }] }));
    expect((await uow.readPersonalGraphView(actor, 'conversation')).positions).toContainEqual(payload.positions[0]);
    expect((await uow.readPersonalGraphView(otherActor, 'conversation')).positions).toContainEqual({ ...payload.positions[0], x: 120 });
    await expect(uow.readPersonalGraphView({ ...actor, actorId: randomUUID() }, 'conversation')).rejects.toMatchObject({ code: 'WORKSPACE_FORBIDDEN' });
    await request(app).get(`/api/v1/workspaces/${randomUUID()}/graph/views/conversation`).expect(403);
    expect(semanticChecksum(await store.read())).toBe(before);
    expect(await store.readGraphProjection()).toEqual(graph);
    expect(await store.readJournal()).toEqual(journal);
    // Membership above was intentionally changed by this fixture, not by view persistence.
    expect({ ...await store.readPortableWorkspace(), members: facts.members }).toEqual(facts);
    const receipt = await database.query<{ first_sequence: unknown; result: unknown; result_content_ref: unknown }>("SELECT first_sequence,result,result_content_ref FROM command_receipts WHERE workspace_id=$1 AND command_type='SavePersonalGraphView'", [workspace.projectId]);
    expect(receipt.rows).toHaveLength(2);
    expect(receipt.rows.every(row => row.first_sequence === null && row.result === null && row.result_content_ref !== null)).toBe(true);
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});

it('M18 rolls back personal layout and receipt together, rejects foreign objects and restores state after reopen', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m18-view-recovery-'));
  let store = await openEmbeddedWorkspaceStore(join(root, 'db'));
  try {
    let app = appFor(store, root); await request(app).get('/api/workspace').expect(200);
    const workspace = await store.read(); const endpoint = `/api/v1/workspaces/${workspace.projectId}/graph/views/conversation`;
    const payload = { expectedRevision: 0, positions: [{ objectType: 'conversation' as const, objectId: workspace.activeNodeId, x: 999, y: 180, collapsed: false }], viewport: { x: 0, y: 0, zoom: 1 }, filters: { objectTypes: [], relationTypes: [] } };
    await request(app).put(endpoint).send({ ...payload, positions: [{ ...payload.positions[0], objectId: randomUUID() }] }).expect(404);
    await request(app).put(endpoint).send({ ...payload, positions: [{ ...payload.positions[0], workspaceId: randomUUID() }] }).expect(400);
    const internal = store as unknown as { prepareReceiptResult(...args: unknown[]): Promise<unknown> };
    const fail = vi.spyOn(internal, 'prepareReceiptResult').mockRejectedValueOnce(new Error('injected receipt publication failure'));
    await request(app).put(endpoint).set('Idempotency-Key', 'layout-retry').send(payload).expect(500); fail.mockRestore();
    expect((await request(app).get(endpoint).expect(200)).body).toMatchObject({ revision: 0, source: 'default' });
    await request(app).put(endpoint).set('Idempotency-Key', 'layout-retry').send(payload).expect(200);
    await store.close(); store = await openEmbeddedWorkspaceStore(join(root, 'db')); app = appFor(store, root);
    expect((await request(app).get(endpoint).expect(200)).body).toMatchObject({ revision: 1, positions: expect.arrayContaining(payload.positions) });
    expect((await request(app).put(endpoint).set('Idempotency-Key', 'layout-retry').send(payload).expect(200)).body.revision).toBe(1);
    const uow = new RepositoryWorkspaceUnitOfWork(store);
    await expect(uow.savePersonalGraphView({ ...payload, viewType: 'conversation' })).rejects.toMatchObject({ code: 'COMMAND_CONTEXT_REQUIRED' });
    const database = (store as unknown as { database: SqlQueryable & { exec(sql: string): Promise<unknown> } }).database;
    await expect(database.exec(await readFile(new URL('../db/migrations/0040_personal_graph_views.down.sql', import.meta.url), 'utf8'))).rejects.toThrow('Personal graph state must be preserved');
    expect((await request(app).get(endpoint).expect(200)).body.revision).toBe(1);
  } finally { vi.restoreAllMocks(); await store.close(); await rm(root, { recursive: true, force: true }); }
});
