// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { expect, it, vi } from 'vitest';
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
    await database.query('INSERT INTO rhiza_projects(id,title,state) VALUES ($1,$2,$3)', [workspace, 'Test', '{}']);
    await database.query("INSERT INTO rhiza_nodes(id,project_id,title,summary,anchor_text,status,kind) VALUES ($1,$2,$3,$4,$5,'active','main')", [node, workspace, original.title, original.summary, original.anchorText]);
    const store = new PostgresWorkspaceStore(database, undefined, undefined, undefined, undefined, undefined, undefined, content);
    const migrationSeal = vi.spyOn(content, 'seal');
    const decode = vi.spyOn(content, 'read').mockResolvedValueOnce({ title: 'wrong', summary: '' });
    await expect((store.forWorkspace(workspace) as PostgresWorkspaceStore).sealLegacyNodeContent(1)).rejects.toThrow('NODE_MIGRATION_CHECKSUM_MISMATCH');
    decode.mockRestore();
    const failedMigration = await migrationSeal.mock.results[0].value;
    await expect(content.read(workspace, node, failedMigration)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect((await store.forWorkspace(workspace).read()).discussionNodes[0]).toMatchObject(original);
    expect(await (store.forWorkspace(workspace) as PostgresWorkspaceStore).sealLegacyNodeContent(1)).toBe(1);
    expect(await (store.forWorkspace(workspace) as PostgresWorkspaceStore).sealLegacyNodeContent(1)).toBe(0);
    migrationSeal.mockRestore();
    expect((await store.forWorkspace(workspace).read()).discussionNodes).toEqual([expect.objectContaining(original)]);
    const scoped = store.forWorkspace(workspace);
    await scoped.update(current => ({ ...current, discussionNodes: current.discussionNodes.map(item => ({ ...item, title: 'updated title' })) }));
    expect((await scoped.read()).discussionNodes[0].title).toBe('updated title');
    const stored = (await database.query<{ title: string; summary: string; anchor_text: unknown; content_ref: Awaited<ReturnType<typeof content.seal>> }>('SELECT title,summary,anchor_text,content_ref FROM rhiza_nodes WHERE id=$1', [node])).rows[0];
    expect(stored).toMatchObject({ title: '[sealed]', summary: '', anchor_text: null, content_ref: { format: 'rhiza.sealed-node.v1' } });
    const seal = vi.spyOn(content, 'seal');
    await database.exec("CREATE FUNCTION reject_node_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected node failure'; END $$; CREATE TRIGGER reject_node_write BEFORE INSERT ON rhiza_nodes FOR EACH ROW EXECUTE FUNCTION reject_node_write();");
    await expect(scoped.update(current => ({ ...current, discussionNodes: current.discussionNodes.map(item => ({ ...item, title: 'failed title' })) }))).rejects.toThrow('injected node failure');
    const failedReference = await seal.mock.results[0].value;
    await expect(content.read(workspace, node, failedReference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect((await scoped.read()).discussionNodes[0].title).toBe('updated title');
    seal.mockRestore();
    await expect(new PostgresWorkspaceStore(database, workspace).read()).rejects.toThrow('NODE_CONTENT_STORE_UNAVAILABLE');
    await content.destroy(workspace, node, stored.content_ref);
    await expect(store.forWorkspace(workspace).read()).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
  } finally { await database.close(); await rm(root, { recursive: true, force: true }); }
}, 30_000);
