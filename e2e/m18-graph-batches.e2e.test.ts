// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { expect, it, vi } from 'vitest';
import { createApp } from '../server/app';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { ProviderService } from '../server/provider-service';
import { ProviderStore } from '../server/provider-store';
import { SecretVault } from '../server/secret-vault';
import { RepositoryWorkspaceUnitOfWork } from '../server/infrastructure/workspace-repository-unit-of-work';
import type { SqlQueryable } from '../server/postgres-store';
import type { GraphBatchItem, GraphBatchResult } from '../server/contracts/graph-batch';
import type { WorkspaceData } from '../server/domain';

function appFor(store: Awaited<ReturnType<typeof openEmbeddedWorkspaceStore>>, root: string) {
  const provider = new ProviderService(new ProviderStore(join(root, 'providers')), new SecretVault(join(root, 'key')), { baseUrl: 'https://example.test', apiKey: '', model: 'fixture', providerName: 'Fixture', chatPath: '/chat', timeoutMs: 1000, temperature: 0, extraHeaders: {}, allowNoKey: true });
  return createApp(store, provider, false, { kind: 'provider-adapter', listModels: async () => [], generate() { throw new Error('Batch operations must not call a model'); } }, undefined, join(root, 'uploads'));
}
async function setup(store: Awaited<ReturnType<typeof openEmbeddedWorkspaceStore>>, root: string) {
  const app = appFor(store, root);
  const workspaceId = (await request(app).post('/api/v1/workspaces').send({ name: 'Batch fixture' }).expect(201)).body.workspace.workspaceId as string;
  const base = `/api/v1/workspaces/${workspaceId}`;
  const nodes = [];
  for (const title of ['Batch A', 'Batch B', 'Batch C']) {
    const result = await request(app).post(`${base}/nodes`).send({ title }).expect(201);
    nodes.push((result.body.workspace as WorkspaceData).discussionNodes.find(node => node.title === title)!);
  }
  await request(app).patch(`${base}/nodes/${nodes[0].id}/status`).send({ status: 'resolved' }).expect(200);
  const items: GraphBatchItem[] = [{ itemId: 'archive', commandType: 'ArchiveObject', payload: { nodeId: nodes[0].id } },
    { itemId: 'relation', commandType: 'CreateRelation', payload: { source: nodes[1].id, target: nodes[2].id, relation: 'related-to', label: 'Private batch label' } }];
  return { app, workspaceId, base, nodes, items };
}

it('runs scoped per-object commands, persists deterministic partial results, and safely undoes successful items with separate events', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m18-batch-'));
  const store = await openEmbeddedWorkspaceStore(join(root, 'db'));
  try {
    const { app, workspaceId, base, nodes, items } = await setup(store, root);
    const scoped = store.forWorkspace(workspaceId), before = await scoped.readJournal!();
    const secondId = (await request(app).post('/api/v1/workspaces').send({ name: 'Foreign fixture' }).expect(201)).body.workspace.workspaceId as string;
    const foreign = (await request(app).get(`/api/v1/workspaces/${secondId}`).expect(200)).body.workspace.discussionNodes[0].id as string;
    const foreignBefore = await store.forWorkspace(secondId).read();
    const selected = [...items, { itemId: 'foreign', commandType: 'ArchiveObject' as const, payload: { nodeId: foreign } }];
    const run = () => request(app).post(`${base}/graph/batches`).set('Idempotency-Key', 'batch-partial').send({ items: selected });
    const result = (await run().expect(200)).body as GraphBatchResult;
    expect(result).toMatchObject({ status: 'partial', outcomes: [{ itemId: 'archive', status: 'succeeded', undoable: true }, { itemId: 'relation', status: 'succeeded', undoable: true }, { itemId: 'foreign', status: 'failed', code: 'NODE_NOT_FOUND' }] });
    const events = (await scoped.readJournal!()).filter(event => !before.some(prior => prior.eventId === event.eventId)).sort((a, b) => a.sequence - b.sequence);
    expect(events.map(event => event.eventType)).toEqual(['object.archived', 'graph.relation.created']);
    expect(events.map(event => event.commandId)).toEqual(result.outcomes.slice(0, 2).map(item => item.steps[0].commandId));
    expect(events[0].aggregateId).toBe(nodes[0].id);
    const edge = (await scoped.read()).discussionEdges.find(edge => edge.source === nodes[1].id && edge.target === nodes[2].id && edge.relation === 'related-to')!;
    expect(events[1].aggregateId).toBe(edge.id);
    expect((await run().expect(200)).body).toEqual(result);
    expect((await request(app).get(`${base}/graph/batches/${result.batchId}`).expect(200)).body).toEqual(result);
    expect((await scoped.readJournal!()).length).toBe(before.length + 2);
    await request(app).post(`${base}/graph/batches`).set('Idempotency-Key', 'batch-partial').send({ items: [items[0]] }).expect(409);
    await request(app).get(`/api/v1/workspaces/${secondId}/graph/batches/${result.batchId}`).expect(404);
    expect(await store.forWorkspace(secondId).read()).toEqual(foreignBefore);
    const metadata = (await (store as unknown as { database: SqlQueryable }).database.query<{ result: unknown; result_content_ref: unknown; first_sequence: unknown }>('SELECT result,result_content_ref,first_sequence FROM command_receipts WHERE workspace_id=$1 AND command_id=$2', [workspaceId, result.batchId])).rows[0];
    expect(metadata.result).toBeNull(); expect(metadata.result_content_ref).toBeTruthy(); expect(metadata.first_sequence).toBeNull();
    const undo = () => request(app).post(`${base}/graph/batches/${result.batchId}/undo`).set('Idempotency-Key', 'undo-partial').send({});
    const undone = (await undo().expect(200)).body as GraphBatchResult;
    expect(undone).toMatchObject({ status: 'completed', outcomes: [{ itemId: 'archive', status: 'succeeded' }, { itemId: 'relation', status: 'succeeded' }, { itemId: 'foreign', status: 'skipped' }] });
    expect((await scoped.read()).discussionNodes.find(node => node.id === nodes[0].id)?.status).toBe('resolved');
    expect((await scoped.read()).discussionEdges.some(item => item.id === edge.id)).toBe(false);
    expect((await scoped.readJournal!()).filter(event => event.sequence > events[1].sequence).sort((a, b) => a.sequence - b.sequence).map(event => event.eventType)).toEqual(['graph.node.status_changed', 'graph.node.status_changed', 'graph.relation.removed']);
    expect((await undo().expect(200)).body).toEqual(undone);
    expect((await scoped.readJournal!()).length).toBe(before.length + 5);
    await request(app).post(`${base}/graph/batches`).send({ items }).expect(400);
    await request(app).post(`${base}/graph/batches`).set('Idempotency-Key', 'forged').send({ items, ownerId: 'foreign' }).expect(400);
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});

it('rolls back prepared metadata on storage failure and resumes only uncommitted children after reopening without automatic work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m18-batch-reopen-'));
  let store = await openEmbeddedWorkspaceStore(join(root, 'db'));
  try {
    const { app, workspaceId, base, items } = await setup(store, root);
    const database = (store as unknown as { database: SqlQueryable & { transaction<T>(work: (active: SqlQueryable) => Promise<T>): Promise<T> } }).database;
    const transaction = database.transaction.bind(database); let injected = false;
    const injection = vi.spyOn(database, 'transaction').mockImplementation(work => transaction(async active => {
      const value = await work(active);
      if (!injected && (await active.query("SELECT 1 FROM command_receipts WHERE workspace_id=$1 AND command_type='BatchGraphOperations'", [workspaceId])).rows.length) {
        injected = true; throw new Error('fixture prepared metadata commit failure');
      }
      return value;
    }));
    const before = await store.forWorkspace(workspaceId).readJournal!();
    try { await request(app).post(`${base}/graph/batches`).set('Idempotency-Key', 'resume-batch').send({ items }).expect(500); }
    finally { injection.mockRestore(); }
    expect(injected).toBe(true);
    expect((await store.forWorkspace(workspaceId).readJournal!()).length).toBe(before.length);
    expect((await database.query("SELECT count(*)::int AS count FROM command_receipts WHERE workspace_id=$1 AND command_type='BatchGraphOperations'", [workspaceId])).rows[0].count).toBe(0);
    const originalExecute = RepositoryWorkspaceUnitOfWork.prototype.execute;
    let childCalls = 0;
    const interruption = vi.spyOn(RepositoryWorkspaceUnitOfWork.prototype, 'execute').mockImplementation(async function (this: RepositoryWorkspaceUnitOfWork, mutation) {
      if (++childCalls === 2) throw new Error('fixture interrupted before next transaction');
      return originalExecute.call(this, mutation);
    });
    let partial: GraphBatchResult;
    try { partial = (await request(app).post(`${base}/graph/batches`).set('Idempotency-Key', 'resume-batch').send({ items }).expect(200)).body; }
    finally { interruption.mockRestore(); }
    expect(partial!.status).toBe('incomplete');
    expect((await store.forWorkspace(workspaceId).readJournal!()).length).toBe(before.length + 1);
    await store.close(); store = await openEmbeddedWorkspaceStore(join(root, 'db'), undefined, 'verify');
    const reopened = appFor(store, root);
    expect((await store.forWorkspace(workspaceId).readJournal!()).length).toBe(before.length + 1);
    expect((await request(reopened).get(`${base}/graph/batches/${partial!.batchId}`).expect(200)).body.status).toBe('incomplete');
    await request(reopened).post(`${base}/graph/batches/${partial!.batchId}/undo`).set('Idempotency-Key', 'premature-undo').send({}).expect(409);
    const complete = (await request(reopened).post(`${base}/graph/batches`).set('Idempotency-Key', 'resume-batch').send({ items }).expect(200)).body;
    expect(complete.status).toBe('completed');
    expect((await store.forWorkspace(workspaceId).readJournal!()).length).toBe(before.length + 2);
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});

it('keeps later edits on undo conflicts and refuses replaying a Purged batch receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m18-batch-undo-'));
  const store = await openEmbeddedWorkspaceStore(join(root, 'db'));
  try {
    const { app, workspaceId, base, nodes, items } = await setup(store, root);
    const result = (await request(app).post(`${base}/graph/batches`).set('Idempotency-Key', 'undo-conflict-source').send({ items }).expect(200)).body as GraphBatchResult;
    expect(result.status).toBe('completed');
    await request(app).patch(`${base}/nodes/${nodes[0].id}/status`).send({ status: 'active' }).expect(200);
    const undo = () => request(app).post(`${base}/graph/batches/${result.batchId}/undo`).set('Idempotency-Key', 'undo-conflict').send({});
    const response = (await undo().expect(200)).body;
    expect(response).toMatchObject({ status: 'partial', outcomes: [{ itemId: 'archive', status: 'failed', steps: [{ code: 'GRAPH_BATCH_ITEM_CHANGED' }, { status: 'blocked' }] }, { itemId: 'relation', status: 'succeeded' }] });
    expect((await store.forWorkspace(workspaceId).read()).discussionNodes.find(node => node.id === nodes[0].id)?.status).toBe('active');
    expect((await undo().expect(200)).body).toEqual(response);
    await request(app).patch(`${base}/nodes/${nodes[0].id}/status`).send({ status: 'archived' }).expect(200);
    const protectedParent = await request(app).post(`${base}/graph/nodes/${nodes[0].id}/purge`).send({ confirmation: `PURGE ${nodes[0].id}`, reason: 'Protected parent fixture' }).expect(409);
    expect(protectedParent.body.error.code).toBe('PURGE_NODE_HAS_CHILDREN');
    await request(app).patch(`${base}/nodes/${nodes[2].id}/status`).send({ status: 'archived' }).expect(200);
    const purged = await request(app).post(`${base}/graph/nodes/${nodes[2].id}/purge`).send({ confirmation: `PURGE ${nodes[2].id}`, reason: 'Batch receipt Purge fixture' });
    expect(purged.status, JSON.stringify(purged.body.error)).toBe(200);
    await request(app).get(`${base}/graph/batches/${result.batchId}`).expect(404);
    await request(app).post(`${base}/graph/batches/${result.batchId}/undo`).set('Idempotency-Key', 'undo-after-purge').send({}).expect(404);
    await request(app).post(`${base}/graph/batches`).set('Idempotency-Key', 'undo-conflict-source').send({ items }).expect(404);
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});
