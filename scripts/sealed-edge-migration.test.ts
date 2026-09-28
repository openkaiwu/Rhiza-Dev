// @vitest-environment node
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { expect, it, vi } from 'vitest';
import { loadMigrations } from './migrate';
import { SealedEdgeContent } from '../server/infrastructure/sealed-edge-content';
import { PostgresWorkspaceStore } from '../server/postgres-store';

it('rejects plaintext alongside edge ciphertext and preserves endpoint constraints', async () => {
  const database = new PGlite();
  const root = await mkdtemp(join(tmpdir(), 'rhiza-edge-sql-'));
  try {
    for (const migration of await loadMigrations()) await database.exec(migration.sql);
    const [workspace, source, target, edge] = [1, 2, 3, 4].map(id => `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`);
    await database.query("INSERT INTO rhiza_projects(id,title,state) VALUES ($1,'Test','{}')", [workspace]);
    for (const node of [source, target]) await database.query("INSERT INTO rhiza_nodes(id,project_id,title,status,kind) VALUES ($1,$2,'Test','active','main')", [node, workspace]);
    const digest = 'a'.repeat(64);
    const ref = JSON.stringify({ format: 'rhiza.sealed-edge.v1', contentId: 'content', reference: {
      version: 1, digest, size: 10, ciphertext: { digestAlgorithm: 'sha256', digest, blobRef: `sha256/aa/${digest}`, size: 39 },
    } });
    await database.query("INSERT INTO rhiza_edges(id,project_id,source_node_id,target_node_id,relation,content_ref) VALUES ($1,$2,$3,$4,'RELATED_TO',$5)", [edge, workspace, source, target, ref]);
    for (const assignment of ["label='private'", 'source_node_id=target_node_id', 'target_node_id=NULL', "relation='invalid'", "content_ref='{}'::jsonb", "content_ref=content_ref || '{\"extra\":true}'::jsonb"]) {
      await expect(database.query(`UPDATE rhiza_edges SET ${assignment} WHERE id=$1`, [edge])).rejects.toThrow();
    }
    await expect(database.exec(await readFile('db/migrations/0024_sealed_edge_content.down.sql', 'utf8'))).rejects.toThrow('Cannot remove sealed edge references');
    expect((await database.query('SELECT label,source_node_id,target_node_id,relation FROM rhiza_edges WHERE id=$1', [edge])).rows[0])
      .toEqual({ label: '', source_node_id: source, target_node_id: target, relation: 'RELATED_TO' });
    const content = SealedEdgeContent.atDirectory(root);
    const reference = await content.seal(workspace, edge, { label: 'private label' });
    await database.query('UPDATE rhiza_edges SET content_ref=$2 WHERE id=$1', [edge, JSON.stringify(reference)]);
    const store = new PostgresWorkspaceStore(database, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, content);
    await database.query("UPDATE rhiza_edges SET content_ref=NULL,label='private label' WHERE id=$1", [edge]);
    const migrate = store.forWorkspace(workspace) as PostgresWorkspaceStore;
    const migrationSeal = vi.spyOn(content, 'seal');
    const decode = vi.spyOn(content, 'read').mockResolvedValueOnce({ label: 'wrong' });
    await expect(migrate.sealLegacyEdgeContent(1)).rejects.toThrow('EDGE_MIGRATION_CHECKSUM_MISMATCH');
    decode.mockRestore();
    await expect(content.read(workspace, edge, await migrationSeal.mock.results[0].value)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect((await database.query('SELECT label,content_ref FROM rhiza_edges WHERE id=$1', [edge])).rows[0]).toEqual({ label: 'private label', content_ref: null });
    expect(await migrate.sealLegacyEdgeContent(1)).toBe(1);
    expect(await migrate.sealLegacyEdgeContent(1)).toBe(0);
    migrationSeal.mockRestore();
    expect((await store.forWorkspace(workspace).read()).discussionEdges).toEqual([expect.objectContaining({ id: edge, source, target, label: 'private label' })]);
    await expect(new PostgresWorkspaceStore(database, workspace).read()).rejects.toThrow('EDGE_CONTENT_STORE_UNAVAILABLE');
    const scoped = store.forWorkspace(workspace);
    await scoped.update(current => ({ ...current, discussionEdges: current.discussionEdges.map(item => ({ ...item, label: 'updated label' })) }));
    const stored = (await database.query<{ label: string; content_ref: typeof reference }>('SELECT label,content_ref FROM rhiza_edges WHERE id=$1', [edge])).rows[0];
    expect(stored.label).toBe('');
    expect((await scoped.read()).discussionEdges[0].label).toBe('updated label');
    const seal = vi.spyOn(content, 'seal');
    await database.exec("CREATE FUNCTION reject_edge_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected edge failure'; END $$; CREATE TRIGGER reject_edge_write BEFORE INSERT ON rhiza_edges FOR EACH ROW EXECUTE FUNCTION reject_edge_write();");
    await expect(scoped.update(current => ({ ...current, discussionEdges: current.discussionEdges.map(item => ({ ...item, label: 'failed label' })) }))).rejects.toThrow('injected edge failure');
    await expect(content.read(workspace, edge, await seal.mock.results[0].value)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect((await scoped.read()).discussionEdges[0].label).toBe('updated label');
    seal.mockRestore();
    await content.destroy(workspace, edge, stored.content_ref);
    await expect(store.forWorkspace(workspace).read()).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
  } finally { await database.close(); await rm(root, { recursive: true, force: true }); }
}, 30_000);
