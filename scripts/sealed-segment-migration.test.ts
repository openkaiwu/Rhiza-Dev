// @vitest-environment node
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { expect, it, vi } from 'vitest';
import { loadMigrations } from './migrate';
import { SealedSegmentContent } from '../server/infrastructure/sealed-segment-content';
import { PostgresWorkspaceStore } from '../server/postgres-store';

it('rejects plaintext alongside segment ciphertext and preserves relational constraints', async () => {
  const database = new PGlite();
  const root = await mkdtemp(join(tmpdir(), 'rhiza-segment-sql-'));
  try {
    for (const migration of await loadMigrations()) await database.exec(migration.sql);
    const [workspace, node, segment] = [1, 2, 3].map(id => `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`);
    await database.query("INSERT INTO rhiza_projects(id,title,state) VALUES ($1,'Test','{}')", [workspace]);
    await database.query("INSERT INTO rhiza_nodes(id,project_id,title,status,kind) VALUES ($1,$2,'Test','active','main')", [node, workspace]);
    const digest = 'a'.repeat(64);
    const ref = JSON.stringify({ format: 'rhiza.sealed-segment.v1', contentId: 'content', reference: {
      version: 1, digest, size: 10, ciphertext: { digestAlgorithm: 'sha256', digest, blobRef: `sha256/aa/${digest}`, size: 39 },
    } });
    await database.query('INSERT INTO rhiza_segments(id,node_id,ordinal,content_ref) VALUES ($1,$2,0,$3)', [segment, node, ref]);
    for (const assignment of ["title='private'", 'ordinal=-1', 'node_id=NULL', "content_ref='{}'::jsonb", "content_ref=content_ref || '{\"extra\":true}'::jsonb"]) {
      await expect(database.query(`UPDATE rhiza_segments SET ${assignment} WHERE id=$1`, [segment])).rejects.toThrow();
    }
    await expect(database.exec(await readFile('db/migrations/0023_sealed_segment_content.down.sql', 'utf8'))).rejects.toThrow('Cannot remove sealed segment references');
    expect((await database.query('SELECT title,ordinal,node_id FROM rhiza_segments WHERE id=$1', [segment])).rows[0]).toEqual({ title: '', ordinal: 0, node_id: node });
    const content = SealedSegmentContent.atDirectory(root);
    const reference = await content.seal(workspace, segment, { title: 'private title' });
    await database.query('UPDATE rhiza_segments SET content_ref=$2 WHERE id=$1', [segment, JSON.stringify(reference)]);
    const store = new PostgresWorkspaceStore(database, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, content);
    expect((await store.forWorkspace(workspace).read()).segments).toEqual([expect.objectContaining({ id: segment, nodeId: node, ordinal: 0, title: 'private title' })]);
    await expect(new PostgresWorkspaceStore(database, workspace).read()).rejects.toThrow('SEGMENT_CONTENT_STORE_UNAVAILABLE');
    const scoped = store.forWorkspace(workspace);
    await scoped.update(current => ({ ...current, segments: current.segments.map(item => ({ ...item, title: 'updated title' })) }));
    const stored = (await database.query<{ title: string; content_ref: typeof reference }>('SELECT title,content_ref FROM rhiza_segments WHERE id=$1', [segment])).rows[0];
    expect(stored.title).toBe('');
    expect((await scoped.read()).segments[0].title).toBe('updated title');
    const seal = vi.spyOn(content, 'seal');
    await database.exec("CREATE FUNCTION reject_segment_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected segment failure'; END $$; CREATE TRIGGER reject_segment_write BEFORE INSERT ON rhiza_segments FOR EACH ROW EXECUTE FUNCTION reject_segment_write();");
    await expect(scoped.update(current => ({ ...current, segments: current.segments.map(item => ({ ...item, title: 'failed title' })) }))).rejects.toThrow('injected segment failure');
    await expect(content.read(workspace, segment, await seal.mock.results[0].value)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect((await scoped.read()).segments[0].title).toBe('updated title');
    seal.mockRestore();
    await content.destroy(workspace, segment, stored.content_ref);
    await expect(store.forWorkspace(workspace).read()).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
  } finally { await database.close(); await rm(root, { recursive: true, force: true }); }
}, 30_000);
