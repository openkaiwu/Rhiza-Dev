import { loadMigrations } from '../scripts/migrate';
// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import type { DomainEventDraft } from '../server/domain-journal';
import { PostgresWorkspaceStore, type SqlQueryable } from '../server/postgres-store';
import { createSeedWorkspace } from '../server/seed';
import { semanticChecksum, semanticStateChecksum } from '../server/infrastructure/workspace-semantic-checksum';

interface TestDatabase extends SqlQueryable {
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
  transaction?<T>(callback: (transaction: SqlQueryable) => Promise<T>): Promise<T>;
  connect?(): Promise<SqlQueryable & { release(): void }>;
}

async function createPostgresDatabase(): Promise<TestDatabase> {
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  const schema = `m05_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}`, max: 10 });
  return Object.assign(pool, {
    exec: (sql: string) => pool.query(sql),
    close: async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); },
  });
}

async function createMigratedDatabase(backend: 'embedded' | 'postgres'): Promise<TestDatabase> {
  const database = backend === 'embedded' ? new PGlite() : await createPostgresDatabase();
  for (const migration of await loadMigrations()) await database.exec(migration.sql);
  return database;
}

const context = (commandId: string, commandType = 'CreateGraphNode') => ({
  commandId,
  commandType,
  actor: { actorType: 'human' as const, actorId: '00000000-0000-4000-8000-000000000002' },
  scope: { scopeType: 'workspace' as const, scopeId: 'unused' },
  occurredAt: '2026-08-30T00:00:00.000Z',
});

function nodeCommand(commandId: string, nodeId = randomUUID()) {
  return {
    context: context(commandId),
    apply: async (current: Awaited<ReturnType<PostgresWorkspaceStore['read']>>) => {
      const createdAt = '2026-08-30T00:00:00.000Z';
      const node = { id: nodeId, title: commandId, summary: 'M05', status: 'draft' as const, kind: 'branch' as const, x: 1, y: 1, createdAt, updatedAt: createdAt };
      return { next: { ...current, discussionNodes: [...current.discussionNodes, node] }, value: { id: nodeId } };
    },
    events: (_previous: unknown, next: Awaited<ReturnType<PostgresWorkspaceStore['read']>>): DomainEventDraft[] => [{ eventType: 'graph.node.created', aggregateType: 'node', aggregateId: nodeId, payload: { workspaceId: next.projectId } }],
  };
}

for (const backend of ['embedded', 'postgres'] as const) {
  describe.skipIf(backend === 'postgres' && !process.env.DATABASE_URL)(`M05 transaction facts and Journal (${backend})`, () => {
    const migratedDatabase = () => createMigratedDatabase(backend);
    it('returns one stable receipt for 100 retries without duplicate events', async () => {
      const database = await migratedDatabase();
      const store = new PostgresWorkspaceStore(database, randomUUID());
      try {
        await store.read();
        const command = nodeCommand('retry-100');
        const results = [];
        for (let attempt = 0; attempt < 100; attempt += 1) results.push(await store.executeCommand(command));
        expect(results.filter(item => item.duplicate)).toHaveLength(99);
        expect((await database.query<{ count: number }>('SELECT count(*)::int count FROM workspace_events')).rows[0]?.count).toBe(1);
        expect((await database.query<{ count: number }>('SELECT count(*)::int count FROM command_receipts')).rows[0]?.count).toBe(1);
      } finally { await database.close(); }
    }, 30_000);

    it('allocates a gap-free workspace-local sequence for 100 concurrent commands', async () => {
      const database = await migratedDatabase();
      const workspaceId = randomUUID();
      const store = new PostgresWorkspaceStore(database, workspaceId);
      try {
        await store.read();
        await Promise.all(Array.from({ length: 100 }, (_, index) => new PostgresWorkspaceStore(database, workspaceId).executeCommand({
          context: context(`concurrent-${index}`, 'ChangeContextMode'),
          apply: async current => ({ next: { ...current, mode: current.mode === 'Auto' ? 'Assisted' as const : 'Auto' as const }, value: undefined }),
          events: (_previous, next): DomainEventDraft[] => [{ eventType: 'context.mode.changed', aggregateType: 'workspace', aggregateId: next.projectId, payload: { mode: next.mode } }],
        })));
        const sequences = (await database.query<{ sequence: number }>('SELECT sequence FROM workspace_events WHERE workspace_id=$1 ORDER BY sequence', [workspaceId])).rows.map(row => Number(row.sequence));
        expect(sequences).toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
        expect(new Set(sequences).size).toBe(100);
      } finally { await database.close(); }
    }, 30_000);

    it.each([
      ['state', 'rhiza_projects', 'BEFORE UPDATE'],
      ['event', 'workspace_events', 'BEFORE INSERT'],
      ['receipt', 'command_receipts', 'BEFORE INSERT'],
    ] as const)('rolls back state, event, and receipt when the %s checkpoint fails', async (checkpoint, table, timing) => {
      const database = await migratedDatabase();
      const workspaceId = randomUUID();
      const store = new PostgresWorkspaceStore(database, workspaceId);
      const nodeId = randomUUID();
      try {
        await store.read();
        await database.exec(`CREATE FUNCTION fail_m05_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'm05 ${checkpoint} failure'; END; $$; CREATE TRIGGER fail_m05_${checkpoint} ${timing} ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_m05_checkpoint();`);
        await expect(store.executeCommand(nodeCommand(`fail-${checkpoint}`, nodeId))).rejects.toThrow(`m05 ${checkpoint} failure`);
        await database.exec(`DROP TRIGGER fail_m05_${checkpoint} ON ${table}; DROP FUNCTION fail_m05_checkpoint();`);
        expect((await database.query<{ count: number }>('SELECT count(*)::int count FROM rhiza_nodes WHERE id=$1', [nodeId])).rows[0]?.count).toBe(0);
        expect((await database.query<{ count: number }>('SELECT count(*)::int count FROM workspace_events WHERE command_id=$1', [`fail-${checkpoint}`])).rows[0]?.count).toBe(0);
        expect((await database.query<{ count: number }>('SELECT count(*)::int count FROM command_receipts WHERE command_id=$1', [`fail-${checkpoint}`])).rows[0]?.count).toBe(0);
      } finally { await database.close(); }
    });

    it('persists deterministic rejections once and never reruns their mutation', async () => {
      const database = await migratedDatabase();
      const store = new PostgresWorkspaceStore(database, randomUUID());
      let attempts = 0;
      const command = {
        ...nodeCommand('rejected-once'),
        apply: async () => { attempts += 1; throw Object.assign(new Error('invalid'), { code: 'INVALID_TEST', status: 409 }); },
      };
      try {
        await store.read();
        const outcomes = await Promise.allSettled([store.executeCommand(command), new PostgresWorkspaceStore(database, store.defaultWorkspaceId).executeCommand(command)]);
        expect(outcomes).toEqual([expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ code: 'INVALID_TEST', status: 409 }) }), expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ code: 'INVALID_TEST', status: 409 }) })]);
        expect(attempts).toBe(1);
        expect((await database.query<{ status: string }>('SELECT status FROM command_receipts')).rows).toEqual([{ status: 'rejected' }]);
      } finally { await database.close(); }
    });

    it('persists the V4.1 envelope and rejects Journal UPDATE/DELETE/TRUNCATE at the database layer', async () => {
      const database = await migratedDatabase();
      const store = new PostgresWorkspaceStore(database, randomUUID());
      try {
        await store.read();
        await store.executeCommand(nodeCommand('append-only'));
        const envelope = (await database.query<Record<string, unknown>>('SELECT * FROM workspace_events WHERE command_id=$1', ['append-only'])).rows[0]!;
        expect({ ...envelope, aggregate_revision: Number(envelope.aggregate_revision) }).toMatchObject({ ce_specversion: '1.0', rhiza_envelope_version: '1.0.0', event_index: 0, aggregate_revision: 0 });
        expect(envelope.event_source).toBe(`urn:rhiza:workspace:${store.defaultWorkspaceId}`);
        expect(envelope.data_schema).toBe('https://rhiza.dev/schemas/events/graph.node.created/v1');
        const ajv = new Ajv2020({ strict: true });
        addFormats(ajv);
        const validate = ajv.compile(JSON.parse(await readFile(resolve('server/contracts/domain-event-envelope.schema.json'), 'utf8')));
        const event = (await store.readJournal())[0]!;
        expect(validate(JSON.parse(JSON.stringify(event))), JSON.stringify(validate.errors)).toBe(true);
        expect(validate({ ...event, eventType: 'token.delta' })).toBe(false);
        await expect(database.query("UPDATE workspace_events SET payload='{}'::jsonb")).rejects.toThrow('workspace_events are append-only');
        await expect(database.query('DELETE FROM workspace_events')).rejects.toThrow('workspace_events are append-only');
        await expect(database.query('TRUNCATE workspace_events')).rejects.toThrow('workspace_events are append-only');
      } finally { await database.close(); }
    });

    it('checks and advances an expected Workspace revision inside the command transaction', async () => {
      const database = await migratedDatabase();
      const workspaceId = randomUUID();
      const store = new PostgresWorkspaceStore(database, workspaceId);
      try {
        await store.workspaceDirectory.ensureWorkspace({ workspaceId, name: 'Revision', status: 'active', createdBy: '00000000-0000-4000-8000-000000000002', revision: 1 });
        await store.initialize({ ...createSeedWorkspace(), projectId: workspaceId });
        await store.executeCommand({ ...nodeCommand('revision-first'), context: { ...context('revision-first'), expectedRevision: 1 } });
        await expect(store.executeCommand({ ...nodeCommand('revision-stale'), context: { ...context('revision-stale'), expectedRevision: 1 } })).rejects.toMatchObject({ code: 'WORKSPACE_REVISION_CONFLICT', status: 409 });
        const revision = (await database.query<{ revision: number }>("SELECT (settings->>'revision')::int revision FROM workspaces WHERE workspace_id=$1", [workspaceId])).rows[0]!.revision;
        expect(revision).toBe(2);
        await store.executeCommand(nodeCommand('revision-without-expectation'));
        await expect(store.executeCommand({ ...nodeCommand('revision-now-stale'), context: { ...context('revision-now-stale'), expectedRevision: 2 } })).rejects.toMatchObject({ code: 'WORKSPACE_REVISION_CONFLICT' });
      } finally { await database.close(); }
    });

    it('refuses to fabricate a baseline after business events already exist', async () => {
      const database = await migratedDatabase();
      const store = new PostgresWorkspaceStore(database, randomUUID());
      try {
        await store.read();
        await store.executeCommand(nodeCommand('tail-before-baseline'));
        await expect(store.backfillJournal()).rejects.toMatchObject({ code: 'JOURNAL_BASELINE_ORDER_CONFLICT', status: 409 });
      } finally { await database.close(); }
    });

    it('creates an idempotent baseline and exposes a low-noise activity timeline', async () => {
      const database = await migratedDatabase();
      const store = new PostgresWorkspaceStore(database, randomUUID());
      try {
        await store.read();
        const first = await store.backfillJournal();
        const second = await store.backfillJournal();
        expect(first).toMatchObject({ created: true, eventCount: 1 });
        expect(second).toEqual({ checksum: first.checksum, created: false, eventCount: 1 });
        const activity = await store.readJournal();
        expect(activity).toEqual([expect.objectContaining({ sequence: 1, eventType: 'workspace.baseline.backfilled' })]);
        expect(activity.map(event => event.eventType).join(' ')).not.toMatch(/token|stdout|file-read|workflow\./i);
        const snapshot = activity[0]!.payload.snapshot as { stateSchema: string; sourceSequence: number; state: Record<string, unknown> };
        expect(snapshot).toMatchObject({ stateSchema: 'rhiza.workspace-semantic.v1', sourceSequence: 0 });
        expect(semanticStateChecksum(snapshot.state)).toBe(first.checksum);
        await store.executeCommand(nodeCommand('after-baseline'));
        const tail = (await store.readJournal()).find(event => event.commandId === 'after-baseline')!;
        expect(semanticStateChecksum({ ...snapshot.state, ...tail.payload.stateChanges as Record<string, unknown> })).toBe(semanticChecksum(await store.read()));
      } finally { await database.close(); }
    });

    it('retries an interrupted baseline without leaving a snapshot half-commit', async () => {
      const database = await migratedDatabase();
      const store = new PostgresWorkspaceStore(database, randomUUID());
      try {
        await store.read();
        await database.exec("CREATE FUNCTION fail_backfill() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'backfill interrupted'; END; $$; CREATE TRIGGER fail_backfill BEFORE INSERT ON command_receipts FOR EACH ROW EXECUTE FUNCTION fail_backfill();");
        await expect(store.backfillJournal()).rejects.toThrow('backfill interrupted');
        expect(await store.readJournal()).toEqual([]);
        expect(await store.readCommandReceipt('backfill:workspace-baseline:v1')).toBeUndefined();
        await database.exec('DROP TRIGGER fail_backfill ON command_receipts; DROP FUNCTION fail_backfill();');
        await expect(store.backfillJournal()).resolves.toMatchObject({ created: true, eventCount: 1 });
        await expect(store.backfillJournal()).resolves.toMatchObject({ created: false, eventCount: 1 });
      } finally { await database.close(); }
    });

    it('commits Workspace create, rename, and archive lifecycle facts with receipts', async () => {
      const database = await migratedDatabase();
      const workspaceId = randomUUID();
      const store = new PostgresWorkspaceStore(database);
      const lifecycleContext = (commandId: string, commandType: string) => ({ ...context(commandId, commandType), scope: { scopeType: 'workspace' as const, scopeId: workspaceId } });
      try {
        const created = await store.executeWorkspaceLifecycle(lifecycleContext('workspace-create', 'CreateWorkspace'), { kind: 'create', workspaceId, name: 'Lifecycle', createdBy: '00000000-0000-4000-8000-000000000002' });
        expect(await store.executeWorkspaceLifecycle(lifecycleContext('workspace-create', 'CreateWorkspace'), { kind: 'create', workspaceId, name: 'Lifecycle', createdBy: created.createdBy })).toEqual(created);
        const renamed = await store.executeWorkspaceLifecycle(lifecycleContext('workspace-rename', 'RenameWorkspace'), { kind: 'rename', workspaceId, name: 'Renamed', expectedRevision: 1 });
        const archived = await store.executeWorkspaceLifecycle(lifecycleContext('workspace-archive', 'ArchiveWorkspace'), { kind: 'archive', workspaceId, expectedRevision: renamed.revision });
        expect(archived).toMatchObject({ name: 'Renamed', status: 'archived', revision: 3 });
        const events = (await database.query<{ event_type: string; sequence: number }>('SELECT event_type,sequence FROM workspace_events WHERE workspace_id=$1 ORDER BY sequence', [workspaceId])).rows;
        expect(events.map(event => ({ ...event, sequence: Number(event.sequence) }))).toEqual([
          { event_type: 'workspace.created', sequence: 1 },
          { event_type: 'workspace.renamed', sequence: 2 },
          { event_type: 'workspace.archived', sequence: 3 },
        ]);
        expect((await database.query<{ count: number }>('SELECT count(*)::int count FROM command_receipts WHERE workspace_id=$1', [workspaceId])).rows[0]?.count).toBe(3);
        await expect((store.forWorkspace(workspaceId) as PostgresWorkspaceStore).backfillJournal()).resolves.toMatchObject({ created: false, eventCount: 3 });
        await expect((store.forWorkspace(workspaceId) as PostgresWorkspaceStore).executeCommand(nodeCommand('write-after-archive'))).rejects.toMatchObject({ code: 'WORKSPACE_ARCHIVED', status: 409 });
      } finally { await database.close(); }
    });
  });
}
