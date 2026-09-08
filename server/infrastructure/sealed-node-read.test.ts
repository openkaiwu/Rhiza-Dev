// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { loadMigrations } from '../../scripts/migrate';
import { PostgresWorkspaceStore } from '../postgres-store';
import { SealedNodeContent } from './sealed-node-content';

it('restores encrypted node content through scoped workspace reads and fails closed without keys', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-node-read-'));
  const database = new PGlite();
  try {
    for (const migration of await loadMigrations()) await database.exec(migration.sql);
    const workspace = '00000000-0000-4000-8000-000000000001';
    const node = '00000000-0000-4000-8000-000000000002';
    const content = SealedNodeContent.atDirectory(root);
    const original = { title: 'private title', summary: 'private summary', anchorText: 'private quote' };
    const reference = await content.seal(workspace, node, original);
    await database.query('INSERT INTO rhiza_projects(id,title,state) VALUES ($1,$2,$3)', [workspace, 'Test', '{}']);
    await database.query("INSERT INTO rhiza_nodes(id,project_id,title,summary,status,kind,content_ref) VALUES ($1,$2,'[sealed]','','active','main',$3)", [node, workspace, JSON.stringify(reference)]);
    const store = new PostgresWorkspaceStore(database, undefined, undefined, undefined, undefined, undefined, undefined, content);
    expect((await store.forWorkspace(workspace).read()).discussionNodes).toEqual([expect.objectContaining(original)]);
    await expect(new PostgresWorkspaceStore(database, workspace).read()).rejects.toThrow('NODE_CONTENT_STORE_UNAVAILABLE');
    await content.destroy(workspace, node, reference);
    await expect(store.forWorkspace(workspace).read()).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
  } finally { await database.close(); await rm(root, { recursive: true, force: true }); }
}, 30_000);
