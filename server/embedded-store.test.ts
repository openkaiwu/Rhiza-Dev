import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { openEmbeddedWorkspaceStore } from './embedded-store';
import { createSeedWorkspace } from './seed';
import { PostgresWorkspaceStore, relationalizeWorkspace, type SqlQueryable } from './postgres-store';
import { semanticChecksum, semanticStateChecksum } from './infrastructure/workspace-semantic-checksum';
import type { ExecutionRun, ContextEnvelope } from './execution-runtime/run';
import { SealedMessageContent } from './infrastructure/sealed-message-content';
import { SealedReceiptContent } from './infrastructure/sealed-receipt-content';
import { SealedRunContent } from './infrastructure/sealed-run-content';
import { SealedJournalContent } from './infrastructure/sealed-journal-content';
import { SealedManifestContent } from './infrastructure/sealed-manifest-content';
import { randomUUID } from 'node:crypto';

describe('embedded Workspace backend', () => {
  it('takes lifecycle locks before transaction work and audits on the locked connection', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-content-lock-'));
    const statements: string[] = [];
    const query = async (sql: string) => { statements.push(sql); return { rows: [] }; };
    const database = { query: async () => { throw new Error('query escaped transaction'); }, transaction: async <T>(callback: (client: SqlQueryable) => Promise<T>) => callback({ query }) };
    const store = new PostgresWorkspaceStore(database, undefined, SealedReceiptContent.atDirectory(join(directory, 'receipts')), SealedRunContent.atDirectory(join(directory, 'runs')), SealedJournalContent.atDirectory(join(directory, 'journal')), SealedMessageContent.atDirectory(join(directory, 'messages')), SealedManifestContent.atDirectory(join(directory, 'manifests')));
    try {
      await store.readExisting();
      expect(statements[0]).toContain("pg_advisory_xact_lock_shared(hashtext('rhiza:content-lifecycle'))");
      statements.length = 0;
      await store.auditHistoricalKeys();
      expect(statements[0]).toBe("SET LOCAL lock_timeout = '5s'");
      expect(statements[1]).toContain("pg_advisory_xact_lock(hashtext('rhiza:content-lifecycle'))");
      expect(statements.slice(2).every(sql => sql.trim().startsWith('SELECT'))).toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('treats an empty configured Workspace ID as absent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-empty-workspace-id-'));
    const store = await openEmbeddedWorkspaceStore(join(directory, 'database'), '');
    try {
      await expect(store.read()).resolves.toMatchObject({ projectId: '00000000-0000-4000-8000-000000000001' });
    } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
  }, 30_000);

  it('rejects a non-UUID configured Workspace ID before issuing a query', async () => {
    const database = new PGlite();
    try {
      expect(() => new PostgresWorkspaceStore(database, 'not-a-uuid')).toThrow('RHIZA_PROJECT_ID must be a UUID when set');
    } finally { await database.close(); }
  });

  it('does not create an absent database or Workspace during reconciliation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-reconcile-'));
    const data = join(directory, 'database');
    try {
      await expect(openEmbeddedWorkspaceStore(data, undefined, 'verify')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(data)).rejects.toMatchObject({ code: 'ENOENT' });
      const store = await openEmbeddedWorkspaceStore(data);
      try {
        expect(await store.readExisting()).toBeUndefined();
        expect(await store.listWorkspaceIds()).toEqual([]);
      } finally { await store.close(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('auto-migrates, persists state, and reopens the same Journal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-pglite-'));
    const data = join(directory, 'database');
    try {
      const first = await openEmbeddedWorkspaceStore(data);
      const seeded = await first.read();
      await first.workspaceDirectory.createWorkspace({ workspaceId: seeded.projectId, name: 'Run persistence test', status: 'active', createdBy: '00000000-0000-4000-8000-000000000002', revision: 1 });
      const baseline = await first.backfillJournal();
      const commandId = randomUUID();
      const context = { commandId, commandType: 'TestReceipt', actor: { actorType: 'human' as const, actorId: '00000000-0000-4000-8000-000000000002' }, scope: { scopeType: 'workspace' as const, scopeId: seeded.projectId }, occurredAt: new Date().toISOString() };
      const input: ContextEnvelope = { schemaVersion: '1.0.0', request: { requestId: commandId, manifestId: 'manifest', projectId: seeded.projectId, nodeId: seeded.activeNodeId, modelId: 'model', prompt: 'private persisted input', history: [], contextItems: [], mode: 'Auto' }, executor: { runtime: 'test', modelSpecRef: 'model', providerEndpointRef: 'endpoint', model: 'model', provider: 'provider' } };
      const run: ExecutionRun = { id: commandId, commandId, workspaceId: seeded.projectId, nodeId: seeded.activeNodeId, status: 'created', attempt: 1, input, inputHash: semanticStateChecksum(input as unknown as Record<string, unknown>), createdAt: context.occurredAt, telemetry: { traceCount: 0 } };
      await first.executeCommand({ context, options: { run: { kind: 'create', run } }, apply: async current => ({ next: current, value: { text: 'encrypted after reopen' } }), events: () => [{ eventType: 'workspace.renamed', aggregateType: 'workspace', aggregateId: seeded.projectId, payload: {} }] });
      const persistedMessages = (await first.read()).messages;
      await first.close();

      const reopened = await openEmbeddedWorkspaceStore(data, undefined, 'verify');
      expect(await reopened.read()).toMatchObject({ projectId: seeded.projectId, activeNodeId: seeded.activeNodeId });
      expect(await reopened.backfillJournal()).toEqual({ checksum: baseline.checksum, created: false, eventCount: 2 });
      expect((await reopened.readCommandReceipt(commandId))?.result).toEqual({ text: 'encrypted after reopen' });
      expect(await reopened.getRun(run.id)).toEqual(run);
      expect((await reopened.read()).messages).toEqual(persistedMessages);
      expect((await reopened.readJournal()).find(event => event.sequence === 1)?.payload.snapshot).toBeTruthy();
      const audit = await reopened.auditHistoricalKeys();
      for (const records of Object.values(audit)) expect(records.every(record => record.referenced && record.state === 'active')).toBe(true);
      expect(audit.messages).toHaveLength(persistedMessages.length);
      expect(audit.runs).toHaveLength(1);
      expect(audit.journal).toHaveLength(2);
      const content = SealedMessageContent.atDirectory(join(`${data}.content`, 'messages'));
      const candidate = await content.seal(seeded.projectId, 'uncommitted-message', { text: 'pending transaction' });
      const candidates = (await reopened.auditHistoricalKeys()).messages.filter(record => !record.referenced);
      expect(candidates).toEqual([expect.objectContaining({ state: 'active' })]);
      expect(await content.read(seeded.projectId, 'uncommitted-message', candidate)).toEqual({ text: 'pending transaction' });
      await reopened.close();
      const inspection = new PGlite(data);
      try {
        const row = await inspection.query<{ result: unknown; result_content_ref: unknown }>('SELECT result,result_content_ref FROM command_receipts WHERE command_id=$1', [commandId]);
        expect(row.rows[0].result).toBeNull();
        expect(row.rows[0].result_content_ref).not.toBeNull();
        const stored = (await inspection.query<{ input_envelope: unknown; record: { input: unknown }; input_content_ref: unknown }>('SELECT input_envelope,record,input_content_ref FROM execution_runs WHERE run_id=$1', [run.id])).rows[0];
        expect(stored.input_envelope).toEqual({ sealed: true });
        expect(stored.record.input).toEqual({ sealed: true });
        expect(stored.input_content_ref).not.toBeNull();
        const events = (await inspection.query<{ payload: unknown; payload_content_ref: unknown }>('SELECT payload,payload_content_ref FROM workspace_events')).rows;
        expect(events).toHaveLength(2);
        expect(events.every(event => JSON.stringify(event.payload) === JSON.stringify({ sealed: true }) && event.payload_content_ref !== null)).toBe(true);
        const messages = (await inspection.query<{ body: string; reasoning: unknown; tool_calls: unknown; content_ref: unknown }>('SELECT body,reasoning,tool_calls,content_ref FROM rhiza_messages')).rows;
        expect(messages.length).toBeGreaterThan(0);
        expect(messages.every(message => message.body === '' && message.reasoning === null && message.tool_calls === null && message.content_ref !== null)).toBe(true);
      } finally { await inspection.close(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 30_000);

  it('imports a complete non-UUID JSON aggregate without dropping semantic content', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-json-import-'));
    const workspaceId = randomUUID();
    const store = await openEmbeddedWorkspaceStore(join(directory, 'database'), workspaceId);
    try {
      const source = createSeedWorkspace();
      const createdAt = '2026-08-30T00:00:00.000Z';
      source.discussionNodes.push({ id: 'legacy-branch', title: 'Legacy branch', summary: 'must survive', status: 'active', kind: 'branch', sourceNodeId: source.activeNodeId, x: 20, y: 30, createdAt, updatedAt: createdAt });
      source.messages.push({ id: 'legacy-message', nodeId: 'legacy-branch', kind: 'user', text: 'legacy content', createdAt });
      const expected = relationalizeWorkspace(source, workspaceId);
      await store.initialize(source);
      const recovered = await store.read();
      expect(semanticChecksum(recovered)).toBe(semanticChecksum(expected));
      expect(recovered.messages).toContainEqual(expect.objectContaining({ text: 'legacy content' }));
      expect(recovered.discussionNodes).toContainEqual(expect.objectContaining({ title: 'Legacy branch', summary: 'must survive' }));
    } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
  }, 30_000);
});
