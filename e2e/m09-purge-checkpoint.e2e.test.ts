// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMigrations } from '../scripts/migrate';
import { PostgresWorkspaceStore, type SqlQueryable } from '../server/postgres-store';
import { SealedNodeContent, type SealedNodeRef } from '../server/infrastructure/sealed-node-content';
import { SealedJournalContent, type SealedJournalRef } from '../server/infrastructure/sealed-journal-content';
import { SealedReceiptContent, type SealedReceiptRef } from '../server/infrastructure/sealed-receipt-content';
import { validatePortableHistory } from '../server/application/portable-history';
import { semanticStateChecksum } from '../server/infrastructure/workspace-semantic-checksum';
import { workspaceSemanticSnapshot } from '../server/domain-journal';

interface TestDatabase extends SqlQueryable {
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
}

async function migratedDatabase(backend: 'embedded' | 'postgres'): Promise<TestDatabase> {
  const database = backend === 'embedded' ? new PGlite() : await (async () => {
    const admin = new Pool({ connectionString: process.env.DATABASE_URL });
    const schema = `m09_purge_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
    return Object.assign(pool, {
      exec: (sql: string) => pool.query(sql),
      close: async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); },
    });
  })();
  for (const migration of await loadMigrations()) await database.exec(migration.sql);
  return database;
}

for (const backend of ['embedded', 'postgres'] as const) describe.skipIf(backend === 'postgres' && !process.env.DATABASE_URL)(`M09 durable Purge checkpoint (${backend})`, () => {
  const directories: string[] = [];
  afterEach(async () => Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))));

  it('commits the tombstone before key revocation and resumes an interrupted revocation after reopen', async () => {
    const database = await migratedDatabase(backend);
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-purge-checkpoint-'));
    directories.push(directory);
    const content = SealedNodeContent.atDirectory(join(directory, 'nodes'));
    const workspaceId = randomUUID();
    const store = new PostgresWorkspaceStore(database, workspaceId, undefined, undefined, undefined, undefined, undefined, content);
    try {
      await store.read();
      const nodeId = randomUUID();
      const createdAt = new Date().toISOString();
      await store.update(current => ({
        ...current,
        discussionNodes: [...current.discussionNodes, {
          id: nodeId, title: 'encrypted purge target', summary: 'must become inaccessible', status: 'archived' as const,
          kind: 'branch' as const, sourceNodeId: current.activeNodeId, x: 10, y: 20, createdAt, updatedAt: createdAt,
        }],
      }));
      const stored = await database.query<{ content_ref: SealedNodeRef }>('SELECT content_ref FROM rhiza_nodes WHERE id=$1', [nodeId]);
      const reference = stored.rows[0]!.content_ref;
      const purgeId = randomUUID();
      vi.spyOn(content, 'destroy').mockRejectedValueOnce(Object.assign(new Error('simulated interruption'), { code: 'SIMULATED_INTERRUPTION' }));

      await store.update(current => ({
        ...current,
        discussionNodes: current.discussionNodes.filter(node => node.id !== nodeId),
        auditEvents: [...current.auditEvents, {
          id: purgeId, projectId: workspaceId, nodeId, action: 'node.purged', entityType: 'node', entityId: nodeId,
          metadata: { reason: 'checkpoint recovery test' }, createdAt: new Date().toISOString(),
        }],
      }), { purge: { nodeId, auditReceiptId: purgeId } });

      expect((await store.read()).discussionNodes.some(node => node.id === nodeId)).toBe(false);
      expect((await database.query<{ phase: string; last_error: string }>('SELECT phase,last_error FROM purge_checkpoints WHERE purge_id=$1', [purgeId])).rows[0])
        .toEqual({ phase: 'pending', last_error: 'SIMULATED_INTERRUPTION' });
      expect((await database.query<{ content_family: string; entity_id: string; revoked_at: unknown }>('SELECT content_family,entity_id,revoked_at FROM purge_key_references WHERE purge_id=$1', [purgeId])).rows)
        .toEqual([{ content_family: 'node', entity_id: nodeId, revoked_at: null }]);

      const reopened = new PostgresWorkspaceStore(database, workspaceId, undefined, undefined, undefined, undefined, undefined, content);
      expect(await reopened.resumePendingPurges()).toEqual({ completed: 1, pending: 0 });
      expect((await database.query<{ phase: string; revoked_at: unknown }>('SELECT phase,revoked_at FROM purge_checkpoints WHERE purge_id=$1', [purgeId])).rows[0])
        .toMatchObject({ phase: 'revoked', revoked_at: expect.anything() });
      await expect(content.read(workspaceId, nodeId, reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
      expect(await reopened.resumePendingPurges()).toEqual({ completed: 0, pending: 0 });
    } finally {
      await database.close();
    }
  }, 30_000);

  it('publishes replayable redacted Journal history before revoking the old payload key', async () => {
    const database = await migratedDatabase(backend);
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-purge-journal-'));
    directories.push(directory);
    const journalContent = SealedJournalContent.atDirectory(join(directory, 'journal'));
    const receiptContent = SealedReceiptContent.atDirectory(join(directory, 'receipts'));
    const workspaceId = randomUUID();
    const store = new PostgresWorkspaceStore(database, workspaceId, receiptContent, undefined, journalContent);
    try {
      const workspace = await store.read();
      await store.workspaceDirectory.ensureWorkspace({ workspaceId, name: 'Journal purge', status: 'active', createdBy: randomUUID(), revision: 1 });
      const nodeId = randomUUID();
      const secondNodeId = randomUUID();
      const removedMessageId = randomUUID();
      const retainedMessageId = randomUUID();
      const createdAt = new Date().toISOString();
      await store.update(current => ({ ...current, messages: [...current.messages,
        { id: removedMessageId, nodeId, kind: 'user', text: 'removed message secret', createdAt },
        { id: retainedMessageId, nodeId: workspace.activeNodeId, kind: 'assistant', text: 'retained reply', sourceMessageId: removedMessageId, createdAt }],
        discussionNodes: [...current.discussionNodes, {
        id: nodeId, title: 'journal secret title', summary: 'journal secret summary', status: 'archived', kind: 'branch',
        sourceNodeId: workspace.activeNodeId, x: 10, y: 20, createdAt, updatedAt: createdAt,
      }, {
        id: secondNodeId, title: 'second journal secret', summary: 'second retained branch', status: 'archived', kind: 'branch',
        sourceNodeId: workspace.activeNodeId, x: 30, y: 40, createdAt, updatedAt: createdAt,
      }] }));
      await store.backfillJournal();
      const receiptId = 'backfill:workspace-baseline:v1';
      const receipt = (await database.query<{ result_content_ref: SealedReceiptRef }>('SELECT result_content_ref FROM command_receipts WHERE workspace_id=$1 AND command_id=$2', [workspaceId, receiptId])).rows[0]!;
      expect((await store.readCommandReceipt(receiptId))?.result).toMatchObject({ checksum: expect.any(String) });
      const original = (await database.query<{ event_id: string; payload_content_ref: SealedJournalRef }>('SELECT event_id,payload_content_ref FROM workspace_events WHERE workspace_id=$1', [workspaceId])).rows[0]!;
      const purgeId = randomUUID();
      vi.spyOn(journalContent, 'destroy').mockRejectedValueOnce(Object.assign(new Error('interrupted'), { code: 'SIMULATED_INTERRUPTION' }));
      await store.update(current => ({
        ...current, discussionNodes: current.discussionNodes.filter(node => node.id !== nodeId),
        messages: current.messages.filter(message => message.id !== removedMessageId)
          .map(message => message.id === retainedMessageId ? { ...message, sourceMessageId: undefined } : message),
        auditEvents: [...current.auditEvents, { id: purgeId, projectId: workspaceId, nodeId, action: 'node.purged', entityType: 'node', entityId: nodeId,
          metadata: { reason: 'journal redaction test' }, createdAt }],
      }), { purge: { nodeId, auditReceiptId: purgeId } });

      expect((await database.query<{ phase: string }>('SELECT phase FROM purge_checkpoints WHERE purge_id=$1', [purgeId])).rows[0]?.phase).toBe('pending');
      const events = await store.readJournal();
      expect(JSON.stringify(events)).not.toContain('journal secret title');
      expect(JSON.stringify(events)).not.toContain('removed message secret');
      const facts = await store.readPortableWorkspace();
      expect(validatePortableHistory(facts, semanticStateChecksum)).toBe(semanticStateChecksum(workspaceSemanticSnapshot(facts.workspace)));
      expect(JSON.stringify(facts)).not.toContain('journal secret title');
      expect(JSON.stringify(facts)).not.toContain('removed message secret');
      expect((await database.query<{ content_family: string }>('SELECT content_family FROM purge_key_references WHERE purge_id=$1', [purgeId])).rows)
        .toContainEqual({ content_family: 'journal' });
      expect((await database.query<{ content_family: string }>('SELECT content_family FROM purge_key_references WHERE purge_id=$1', [purgeId])).rows)
        .toContainEqual({ content_family: 'receipt-result' });
      expect((await store.readCommandReceipt(receiptId))?.result).toBeUndefined();
      const apply = vi.fn(async (current: Awaited<ReturnType<PostgresWorkspaceStore['read']>>) => ({ next: current, value: { checksum: 'unexpected' } }));
      await expect(store.executeCommand({
        context: { commandId: receiptId, commandType: 'BackfillWorkspaceBaseline',
          actor: { actorType: 'system', actorId: 'journal-backfill-v1' },
          scope: { scopeType: 'workspace', scopeId: workspaceId }, occurredAt: createdAt },
        apply, events: () => [],
      })).rejects.toMatchObject({ code: 'RECEIPT_PURGED', status: 410 });
      expect(apply).not.toHaveBeenCalled();

      const reopened = new PostgresWorkspaceStore(database, workspaceId, receiptContent, undefined, journalContent);
      expect(await reopened.resumePendingPurges()).toEqual({ completed: 1, pending: 0 });
      await expect(journalContent.read(workspaceId, original.event_id, original.payload_content_ref)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
      await expect(receiptContent.read(workspaceId, receiptId, receipt.result_content_ref)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
      expect(JSON.stringify(await reopened.readJournal())).not.toContain('journal secret title');

      const secondPurgeId = randomUUID();
      await reopened.update(current => ({ ...current, discussionNodes: current.discussionNodes.filter(node => node.id !== secondNodeId),
        auditEvents: [...current.auditEvents, { id: secondPurgeId, projectId: workspaceId, nodeId: secondNodeId,
          action: 'node.purged', entityType: 'node', entityId: secondNodeId, metadata: { reason: 'second purge' }, createdAt }],
      }), { purge: { nodeId: secondNodeId, auditReceiptId: secondPurgeId } });
      const twiceRedacted = await reopened.readPortableWorkspace();
      expect(JSON.stringify(twiceRedacted)).not.toContain('second journal secret');
      expect(validatePortableHistory(twiceRedacted, semanticStateChecksum)).toBe(semanticStateChecksum(workspaceSemanticSnapshot(twiceRedacted.workspace)));
    } finally { await database.close(); }
  }, 30_000);

  it('does not stage a Purge while a historical command receipt still contains plaintext', async () => {
    const database = await migratedDatabase(backend);
    const workspaceId = randomUUID();
    const store = new PostgresWorkspaceStore(database, workspaceId);
    try {
      await store.read();
      await store.backfillJournal();
      const nodeId = randomUUID();
      const purgeId = randomUUID();
      const createdAt = new Date().toISOString();
      await store.update(current => ({ ...current, discussionNodes: [...current.discussionNodes, {
        id: nodeId, title: 'kept on failed purge', summary: '', status: 'archived', kind: 'branch',
        x: 0, y: 0, createdAt, updatedAt: createdAt,
      }] }));
      await expect(store.update(current => ({ ...current,
        discussionNodes: current.discussionNodes.filter(node => node.id !== nodeId),
        auditEvents: [...current.auditEvents, { id: purgeId, projectId: workspaceId, nodeId,
          action: 'node.purged', entityType: 'node', entityId: nodeId, metadata: { reason: 'test' }, createdAt }],
      }), { purge: { nodeId, auditReceiptId: purgeId } })).rejects.toMatchObject({ code: 'PURGE_RECEIPT_MIGRATION_REQUIRED', status: 409 });
      expect((await store.read()).discussionNodes.some(node => node.id === nodeId)).toBe(true);
      expect((await database.query<{ count: number }>('SELECT count(*)::int count FROM purge_checkpoints')).rows[0]?.count).toBe(0);
    } finally { await database.close(); }
  }, 30_000);
});
