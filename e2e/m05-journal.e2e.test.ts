// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import type { DomainEventDraft } from '../server/domain-journal';
import { PostgresWorkspaceStore } from '../server/postgres-store';

async function migratedDatabase() {
  const database = new PGlite();
  for (const migration of ['0001_rhiza_core', '0002_chat_parity', '0003_domain_persistence', '0004_immutable_manifest_history', '0005_identity_workspace_scope', '0006_resource_blob_host', '0007_domain_journal_facts']) {
    await database.exec(await readFile(resolve(`db/migrations/${migration}.up.sql`), 'utf8'));
  }
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

describe('M05 transaction facts and Journal', () => {
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
      await Promise.all(Array.from({ length: 100 }, (_, index) => store.executeCommand({
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
      await expect(store.executeCommand(command)).rejects.toMatchObject({ code: 'INVALID_TEST', status: 409 });
      await expect(store.executeCommand(command)).rejects.toMatchObject({ code: 'INVALID_TEST', status: 409 });
      expect(attempts).toBe(1);
      expect((await database.query<{ status: string }>('SELECT status FROM command_receipts')).rows).toEqual([{ status: 'rejected' }]);
    } finally { await database.close(); }
  });

  it('rejects Journal UPDATE/DELETE at the database layer', async () => {
    const database = await migratedDatabase();
    const store = new PostgresWorkspaceStore(database, randomUUID());
    try {
      await store.read();
      await store.executeCommand(nodeCommand('append-only'));
      await expect(database.query("UPDATE workspace_events SET payload='{}'::jsonb")).rejects.toThrow('workspace_events are append-only');
      await expect(database.query('DELETE FROM workspace_events')).rejects.toThrow('workspace_events are append-only');
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
      expect(JSON.stringify(activity)).not.toMatch(/token|stdout|file-read|workflow\./i);
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
      expect(events).toEqual([
        { event_type: 'workspace.created', sequence: 1 },
        { event_type: 'workspace.renamed', sequence: 2 },
        { event_type: 'workspace.archived', sequence: 3 },
      ]);
      expect((await database.query<{ count: number }>('SELECT count(*)::int count FROM command_receipts WHERE workspace_id=$1', [workspaceId])).rows[0]?.count).toBe(3);
    } finally { await database.close(); }
  });
});
