// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { inspectM10Store } from './m10-inspection';

it('reconciles multiple Workspaces without initializing, modifying, or hiding a missing baseline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m10-inspect-'));
  const store = await openEmbeddedWorkspaceStore(join(root, 'db'));
  try {
    for (const id of [store.defaultWorkspaceId, randomUUID()]) {
      const scoped = store.forWorkspace(id);
      await store.workspaceDirectory.ensureWorkspace({ workspaceId: id, name: 'Inspection', status: 'active', createdBy: randomUUID(), revision: 1 });
      await scoped.read();
      await scoped.backfillJournal!();
    }
    const first = await inspectM10Store(store);
    expect(first.ok).toBe(true);
    expect(first.workspaces).toHaveLength(2);
    expect(first.workspaces.every(item => item.match)).toBe(true);
    expect(await inspectM10Store(store)).toEqual(first);
    const id = randomUUID();
    await store.forWorkspace(id).read();
    const broken = await inspectM10Store(store);
    expect(broken.ok).toBe(false);
    expect(broken.workspaces.find(item => item.workspaceId === id)?.error).toBe('M10_JOURNAL_BASELINE_MISSING');
    expect(await store.forWorkspace(id).readJournal!()).toEqual([]);
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
}, 30_000);

it('reports an unfinished post-commit Purge without revoking or acknowledging it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m10-pending-'));
  let store = await openEmbeddedWorkspaceStore(join(root, 'db'));
  try {
    const workspace = await store.read();
    await store.backfillJournal();
    await store.close();
    const database = new PGlite(join(root, 'db'));
    try {
      const purgeId = randomUUID();
      await database.query('INSERT INTO purge_checkpoints(purge_id,workspace_id,node_id) VALUES ($1,$2,$3)', [purgeId, workspace.projectId, workspace.activeNodeId]);
      await database.query("INSERT INTO purge_key_references(purge_id,ordinal,content_family,entity_id,content_ref) VALUES ($1,0,'node',$2,'{}')", [purgeId, workspace.activeNodeId]);
    } finally { await database.close(); }
    store = await openEmbeddedWorkspaceStore(join(root, 'db'), undefined, 'verify');
    const report = await inspectM10Store(store);
    expect(report.ok).toBe(false);
    expect(report.purge).toEqual({ pending: 1, unrevokedReferences: 1 });
    expect(await inspectM10Store(store)).toEqual(report);
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
}, 30_000);
