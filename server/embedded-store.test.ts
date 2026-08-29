import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openEmbeddedWorkspaceStore } from './embedded-store';
import { createSeedWorkspace } from './seed';
import { relationalizeWorkspace } from './postgres-store';
import { semanticChecksum } from './infrastructure/workspace-semantic-checksum';
import { randomUUID } from 'node:crypto';

describe('embedded Workspace backend', () => {
  it('auto-migrates, persists state, and reopens the same Journal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-pglite-'));
    const data = join(directory, 'database');
    try {
      const first = await openEmbeddedWorkspaceStore(data);
      const seeded = await first.read();
      const baseline = await first.backfillJournal();
      await first.close();

      const reopened = await openEmbeddedWorkspaceStore(data);
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
