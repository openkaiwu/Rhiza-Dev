// @vitest-environment node
import { Pool } from 'pg';
import type { SqlQueryable } from '../server/postgres-store';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { loadMigrations } from '../scripts/migrate';
import { PostgresWorkspaceStore } from '../server/postgres-store';
import { createApp } from '../server/app';
import type { AIRuntime, RuntimeRequest } from '../server/ai-runtime';
import { ProviderService } from '../server/provider-service';
import { ProviderStore } from '../server/provider-store';
import { SecretVault } from '../server/secret-vault';
import type { ExecutionRun } from '../server/execution-runtime/run';
import { semanticStateChecksum } from '../server/infrastructure/workspace-semantic-checksum';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const model = { id: 'model-one', providerEndpointRef: 'endpoint-one', model: 'same-model', provider: 'Provider', displayName: 'Test', active: true };
interface TestDatabase extends SqlQueryable {
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
  transaction?<T>(callback: (transaction: SqlQueryable) => Promise<T>): Promise<T>;
  connect?(): Promise<SqlQueryable & { release(): void }>;
}
async function postgresDatabase(): Promise<TestDatabase> {
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  const schema = `m06_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}`, max: 10 });
  return Object.assign(pool, { exec: (sql: string) => pool.query(sql), close: async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } });
}
async function fixture(generate: AIRuntime['generate'], backend: 'embedded' | 'postgres') {
  const database: TestDatabase = backend === 'embedded' ? new PGlite() : await postgresDatabase();
  cleanups.push(() => database.close());
  for (const migration of await loadMigrations()) await database.exec(migration.sql);
  const store = new PostgresWorkspaceStore(database);
  const directory = await mkdtemp(join(tmpdir(), 'rhiza-m06-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const provider = new ProviderService(new ProviderStore(join(directory, 'providers.json')), new SecretVault(join(directory, 'key')), { baseUrl: 'https://example.test/v1', apiKey: 'secret-never-in-run', model: 'same-model', providerName: 'Test', chatPath: '/chat/completions', timeoutMs: 1000, temperature: 0.4, extraHeaders: {}, allowNoKey: false });
  const app = createApp(store, provider, false, { kind: 'provider-adapter', listModels: async () => [model], generate }, undefined, join(directory, 'uploads'));
  await request(app).get('/api/workspace').expect(200);
  await store.backfillJournal();
  return { database, store, app };
}
async function* success(input: RuntimeRequest) {
  yield { type: 'RUN_END' as const, requestId: input.requestId, text: 'answer', model: 'same-model', provider: 'Provider' };
}

for (const backend of ['embedded', 'postgres'] as const) {
describe.skipIf(backend === 'postgres' && !process.env.DATABASE_URL)(`M06 durable Chat execution (${backend})`, () => {
  const setup = (generate: AIRuntime['generate']) => fixture(generate, backend);
  it('commits terminal, messages and immutable input together; regenerate creates a child; retries deduplicate external calls', async () => {
    let calls = 0;
    const { app, store, database } = await setup(async function* (input) { calls++; yield* success(input); });
    const initial = await store.read();
    const response = await request(app).post('/api/chat').set('Idempotency-Key', 'same-command').set('If-Match', '1').send({ message: 'hello' }).expect(201);
    await request(app).post('/api/chat').set('Idempotency-Key', 'same-command').set('If-Match', '1').send({ message: 'hello' }).expect(201);
    expect(calls).toBe(1);
    const [run] = await store.listRuns();
    expect(run.status).toBe('completed');
    expect(run.inputHash).toBe(semanticStateChecksum(run.input as unknown as Record<string, unknown>));
    expect(JSON.stringify(run)).not.toContain('secret-never-in-run');
    expect((await store.read()).messages.length).toBe(initial.messages.length + 2);
    await expect(database.query("UPDATE execution_runs SET input_envelope='{}' WHERE run_id=$1", [run.id])).rejects.toThrow(/immutable/);
    await expect(database.query("UPDATE execution_runs SET status='running' WHERE run_id=$1", [run.id])).rejects.toThrow(/immutable/);
    await request(app).post('/api/chat').send({ message: 'regenerate', operation: 'regenerate', sourceMessageId: response.body.assistantMessage.id }).expect(201);
    const child = (await store.listRuns()).find(item => item.id !== run.id)!;
    expect(child.parentRunRef).toBe(run.id);
    expect(await store.getRun(run.id)).toEqual(run);
  });

  it('records provider errors and missing RUN_END without adding messages', async () => {
    let calls = 0;
    const { app, store } = await setup(async function* (input) {
      if (calls++ === 0) yield { type: 'RUN_ERROR', requestId: input.requestId, code: 'PROVIDER_TIMEOUT', message: 'secret-never-in-run', status: 504 };
    });
    const before = (await store.read()).messages;
    await request(app).post('/api/chat').send({ message: 'timeout' }).expect(504);
    await request(app).post('/api/chat').send({ message: 'disconnect' }).expect(502);
    const runs = await store.listRuns();
    expect(runs.map(run => run.status).sort()).toEqual(['failed', 'interrupted']);
    expect(runs.find(run => run.status === 'failed')?.error?.class).toBe('timeout');
    expect((await store.read()).messages).toEqual(before);
    expect(JSON.stringify(runs)).not.toContain('secret-never-in-run');
  });

  it('cancels an uncooperative running provider durably and rejects late output', async () => {
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const { app, store } = await setup(async function* (input) { entered(); await held; yield* success(input); });
    const before = (await store.read()).messages;
    const running = request(app).post('/api/chat').send({ message: 'cancel this' }).then(response => response);
    await enteredPromise;
    const [run] = await store.listRuns();
    expect(run.status).toBe('running');
    const canceled = await request(app).post(`/api/v1/runs/${run.id}/cancel`).send({ workspaceId: run.workspaceId }).expect(200);
    expect(canceled.body.run.status).toBe('canceled');
    expect((await running).status).toBe(499);
    release();
    await new Promise(resolve => setImmediate(resolve));
    expect((await store.getRun(run.id))?.status).toBe('canceled');
    expect((await store.read()).messages).toEqual(before);
    await request(app).post(`/api/runs/${run.id}/cancel`).expect(200);
  });

  it.each(['created', 'dispatching'] as const)('cancels during %s before any external call', async status => {
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    const { app, store } = await setup(async function* (input) { calls++; yield* success(input); });
    const execute = store.executeCommand.bind(store);
    store.executeCommand = async command => {
      const result = await execute(command);
      const mutation = command.options?.run;
      if ((status === 'created' && mutation?.kind === 'create') || (status === 'dispatching' && mutation?.kind === 'transition' && mutation.patch.status === status)) { entered(); await hold; }
      return result;
    };
    const running = request(app).post('/api/chat').send({ message: 'cancel before dispatch' }).then(response => response);
    await ready;
    const [run] = await store.listRuns();
    await request(app).post(`/api/runs/${run.id}/cancel`).expect(200);
    release();
    await running;
    expect(calls).toBe(0);
    expect((await store.getRun(run.id))?.status).toBe('canceled');
  });

  it('rolls back a successful terminal transition when message persistence fails', async () => {
    const { app, database, store } = await setup(success);
    const before = (await store.read()).messages;
    await database.exec(`CREATE FUNCTION fail_run_message() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected message failure'; END $$;
      CREATE TRIGGER fail_run_message BEFORE INSERT ON rhiza_messages FOR EACH ROW EXECUTE FUNCTION fail_run_message();`);
    await request(app).post('/api/chat').send({ message: 'cannot commit' }).expect(500);
    const [run] = await store.listRuns();
    expect(run.status).toBe('failed');
    expect(run.error?.class).toBe('commit');
    expect((await store.read()).messages).toEqual(before);
    expect((await store.readJournal()).some(event => event.eventType === 'conversation.run.committed')).toBe(false);
  });

  it('rejects cross-workspace reads/cancels and unrelated retry parents', async () => {
    const { app, store } = await setup(success);
    await request(app).post('/api/chat').send({ message: 'one' }).expect(201);
    const [run] = await store.listRuns();
    const created = await request(app).post('/api/v1/workspaces').send({ name: 'Other' }).expect(201);
    const scope = `/api/v1/workspaces/${created.body.workspace.workspaceId}`;
    await request(app).get(`${scope}/runs/${run.id}`).expect(404);
    await request(app).post(`${scope}/runs/${run.id}/cancel`).expect(404);
    await request(app).post(`${scope}/chat`).send({ message: 'retry', parentRunRef: run.id, operation: 'retry' }).expect(400);
  });

  it('stores 10k traces outside the Domain Journal and tracks temporary calls', async () => {
    const { app, store, database } = await setup(async function* (input) {
      for (let i = 0; i < 10000; i++) yield { type: 'CONTENT_DELTA', requestId: input.requestId, delta: 'x' };
      yield* success(input);
    });
    const before = await store.read();
    await request(app).post('/api/temp-chat').send({ message: 'temporary', sourceNodeId: before.activeNodeId, anchorText: 'anchor' }).expect(201);
    const [run] = await store.listRuns();
    expect(run.status).toBe('completed');
    expect(run.telemetry.traceCount).toBe(10001);
    expect((await database.query<{ count: number }>('SELECT count(*)::int count FROM execution_run_traces')).rows[0].count).toBe(10001);
    expect((await store.readJournal()).length).toBeLessThanOrEqual(10);
    expect((await store.read()).messages).toEqual(before.messages);
  });

  it.each(['created', 'dispatching', 'running'] as const)('reconciles a process crash in %s without replaying the provider', async status => {
    const { app, store, database } = await setup(success);
    await request(app).post('/api/chat').send({ message: 'seed input' }).expect(201);
    const [completed] = await store.listRuns();
    const run: ExecutionRun = { ...completed, id: randomUUID(), commandId: randomUUID(), status, terminalAt: undefined };
    // Simulate the durable pre-crash row at each supported nonterminal checkpoint.
    await database.query(`INSERT INTO execution_runs (run_id,workspace_id,command_id,node_id,status,attempt,input_envelope,input_hash,model_spec_ref,provider_endpoint_ref,record)
      VALUES ($1,$2,$3,$4,$5,1,$6::jsonb,$7,$8,$9,$10::jsonb)`, [run.id, run.workspaceId, run.commandId, run.nodeId, status, JSON.stringify(run.input), run.inputHash, model.id, model.providerEndpointRef, JSON.stringify(run)]);
    const reopened = new PostgresWorkspaceStore(database);
    expect(await reopened.reconcileRuns()).toBe(1);
    expect(await reopened.reconcileRuns()).toBe(0);
    expect((await reopened.getRun(run.id))?.status).toBe('interrupted');
    expect((await request(app).get(`/api/runs/${run.id}`).expect(200)).body.run.error.code).toBe('PROCESS_INTERRUPTED');
  });
});

}
