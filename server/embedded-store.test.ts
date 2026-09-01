import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { openEmbeddedWorkspaceStore } from './embedded-store';
import { createSeedWorkspace } from './seed';
import { PostgresWorkspaceStore, relationalizeWorkspace } from './postgres-store';
import { semanticChecksum } from './infrastructure/workspace-semantic-checksum';
import { randomUUID } from 'node:crypto';

describe('embedded Workspace backend', () => {
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
      const baseline = await first.backfillJournal();
      await first.close();

      const reopened = await openEmbeddedWorkspaceStore(data, undefined, 'verify');
      expect(await reopened.read()).toMatchObject({ projectId: seeded.projectId, activeNodeId: seeded.activeNodeId });
      expect(await reopened.backfillJournal()).toEqual({ checksum: baseline.checksum, created: false, eventCount: 1 });
      await reopened.close();
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
