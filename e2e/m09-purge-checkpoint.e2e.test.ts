// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMigrations } from '../scripts/migrate';
import { PostgresWorkspaceStore } from '../server/postgres-store';
import { SealedNodeContent, type SealedNodeRef } from '../server/infrastructure/sealed-node-content';

describe('M09 durable Purge checkpoint', () => {
  const directories: string[] = [];
  afterEach(async () => Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))));

  it('commits the tombstone before key revocation and resumes an interrupted revocation after reopen', async () => {
    const database = new PGlite();
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-purge-checkpoint-'));
    directories.push(directory);
    const content = SealedNodeContent.atDirectory(join(directory, 'nodes'));
    const workspaceId = randomUUID();
    const store = new PostgresWorkspaceStore(database, workspaceId, undefined, undefined, undefined, undefined, undefined, content);
    try {
      for (const migration of await loadMigrations()) await database.exec(migration.sql);
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
});
