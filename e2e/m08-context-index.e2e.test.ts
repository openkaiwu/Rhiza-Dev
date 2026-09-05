// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it, vi } from 'vitest';
import { loadMigrations } from '../scripts/migrate';
import { PostgresWorkspaceStore, type SqlQueryable } from '../server/postgres-store';
import { createSeedWorkspace } from '../server/seed';
import { queryContextCandidates } from '../server/context-runtime/postgres-index';

describe('M08 materialized candidate index', () => {
  it('prepares only the active conversation and requested attachments with unchanged message metadata', async () => {
    const database = new PGlite();
    try {
      for (const migration of await loadMigrations()) await database.exec(migration.sql);
      const store = new PostgresWorkspaceStore(database);
      await store.initialize(createSeedWorkspace());
      const workspace = await store.read();
      const read = vi.spyOn(store, 'read').mockRejectedValue(new Error('aggregate read forbidden'));
      const prepared = await store.readConversationPreparation(workspace.attachments.map(item => item.id));
      expect(read).not.toHaveBeenCalled();
      expect(prepared).toEqual({
        projectId: workspace.projectId, activeNodeId: workspace.activeNodeId,
        node: { id: workspace.activeNodeId, status: workspace.discussionNodes.find(node => node.id === workspace.activeNodeId)!.status },
        mode: workspace.mode, contextItems: workspace.contextItems,
        messages: workspace.messages.filter(message => message.nodeId === workspace.activeNodeId), attachments: workspace.attachments,
      });
      expect((await store.readConversationPreparation(['missing-attachment'])).attachments).toEqual([]);
      const other = store.forWorkspace('a0637216-ccf0-4d55-a2d5-8bb5b8061111');
      const otherWorkspace = await other.initialize!(createSeedWorkspace());
      const otherPrepared = await other.readConversationPreparation!([]);
      expect(otherPrepared.projectId).toBe(otherWorkspace.projectId);
      expect(otherPrepared.messages.every(message => message.nodeId === otherWorkspace.activeNodeId)).toBe(true);
      expect(otherPrepared.activeNodeId).not.toBe(prepared.activeNodeId);
    } finally { await database.close(); }
  });

  it('maintains changed sources transactionally and queries bounded rows without Workspace reads', async () => {
    const database = new PGlite();
    try {
      for (const migration of await loadMigrations()) await database.exec(migration.sql);
      const store = new PostgresWorkspaceStore(database);
      await store.initialize(createSeedWorkspace());
      let workspace = await store.read();
      const input = { workspaceId: workspace.projectId, nodeId: workspace.activeNodeId, query: '支付', mode: 'Assisted' as const, selection: workspace.contextItems, attachmentIds: [], budget: 1000 };
      const statements: string[] = [];
      const audited: SqlQueryable = { query: async (sql, values) => {
        statements.push(sql);
        if (/FROM rhiza_(nodes|messages|projects|segments|attachments)\b/i.test(sql)) throw new Error('full Workspace source read');
        return database.query(sql, values);
      } };
      const first = await queryContextCandidates(audited, input);
      expect(first.selection.filter(item => item.status === 'active').every(item => item.content)).toBe(true);
      expect(statements.some(sql => sql.includes('LIMIT 500'))).toBe(true);
      expect(first.audit).toMatchObject({ fullWorkspaceScans: 0 });
      expect(first.audit.queries?.map(query => query.statement)).toEqual(statements);
      const before = await database.query<{ source_id: string; source_digest: string }>("SELECT source_id,source_digest FROM context_candidate_index WHERE source_type='node'");
      await store.update(current => ({ ...current, messages: [...current.messages, { id: 'a0637216-ccf0-4d55-a2d5-8bb5b8068888', nodeId: current.activeNodeId, kind: 'user', text: '支付退款新证据', createdAt: new Date().toISOString() }] }));
      workspace = await store.read();
      const next = await queryContextCandidates(audited, { ...input, selection: workspace.contextItems });
      expect(Number(next.revision)).toBeGreaterThan(Number(first.revision));
      expect(next.candidates.find(item => item.item.sourceId === workspace.activeNodeId)?.text).toContain('支付退款新证据');
      const after = await database.query<{ source_id: string; source_digest: string }>("SELECT source_id,source_digest FROM context_candidate_index WHERE source_type='node'");
      expect(after.rows.filter(row => before.rows.find(old => old.source_id === row.source_id)?.source_digest !== row.source_digest).map(row => row.source_id)).toEqual([workspace.activeNodeId]);
      const rowsBefore = (await database.query('SELECT * FROM context_candidate_index ORDER BY source_type,source_id')).rows;
      const failing = new PostgresWorkspaceStore({ query: database.query.bind(database), transaction: work => database.transaction(transaction => work({
        query: async <Row>(sql: string, values?: unknown[]) => {
          if (sql.includes('INSERT INTO context_candidate_heads')) throw new Error('crash before checkpoint');
          return transaction.query<Row>(sql, values);
        },
      })) });
      await expect(failing.update(current => ({ ...current, messages: [...current.messages, { id: 'a0637216-ccf0-4d55-a2d5-8bb5b8069999', nodeId: current.activeNodeId, kind: 'user', text: 'must roll back', createdAt: new Date().toISOString() }] }))).rejects.toThrow('crash before checkpoint');
      expect((await store.read()).messages.some(message => message.text === 'must roll back')).toBe(false);
      expect((await database.query('SELECT * FROM context_candidate_index ORDER BY source_type,source_id')).rows).toEqual(rowsBefore);
      await store.rebuildContextCandidates();
      expect((await database.query('SELECT * FROM context_candidate_index ORDER BY source_type,source_id')).rows).toEqual(rowsBefore);
      await expect(queryContextCandidates(audited, { ...input, selection: [{ ...workspace.contextItems[0], sourceType: 'node', sourceId: 'missing', status: 'active' }] })).rejects.toMatchObject({ code: 'CONTEXT_SOURCE_NOT_FOUND' });
    } finally { await database.close(); }
  });
});
