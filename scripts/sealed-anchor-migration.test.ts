// @vitest-environment node
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { loadMigrations } from './migrate';
import { SealedAnchorContent } from '../server/infrastructure/sealed-anchor-content';
import { PostgresWorkspaceStore } from '../server/postgres-store';

it('requires an association for sealed anchor text and refuses plaintext coexistence or lossy rollback', async () => {
  const database = new PGlite();
  const root = await mkdtemp(join(tmpdir(), 'rhiza-anchor-sql-'));
  try {
    for (const migration of await loadMigrations()) await database.exec(migration.sql);
    const ids = [1, 2, 3, 4].map(id => `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`);
    const [workspace, node, segment, anchor] = ids;
    await database.query("INSERT INTO rhiza_projects(id,title,state) VALUES ($1,'Test','{}')", [workspace]);
    await database.query("INSERT INTO rhiza_nodes(id,project_id,title,status,kind) VALUES ($1,$2,'Test','active','main')", [node, workspace]);
    await database.query('INSERT INTO rhiza_segments(id,node_id,ordinal) VALUES ($1,$2,0)', [segment, node]);
    await database.query('INSERT INTO rhiza_anchors(id,project_id,node_id) VALUES ($1,$2,$3)', [anchor, workspace, node]);
    const digest = 'a'.repeat(64);
    const ref = JSON.stringify({ format: 'rhiza.sealed-anchor.v1', contentId: 'content', reference: {
      version: 1, digest, size: 10, ciphertext: { digestAlgorithm: 'sha256', digest, blobRef: `sha256/aa/${digest}`, size: 39 },
    } });
    await expect(database.query('UPDATE rhiza_anchors SET content_ref=$2 WHERE id=$1', [anchor, ref])).rejects.toThrow();
    await database.query('UPDATE rhiza_anchors SET segment_id=$2,content_ref=$3 WHERE id=$1', [anchor, segment, ref]);
    for (const assignment of ["selected_text='private'", 'segment_id=NULL', "content_ref='{}'::jsonb", "content_ref=content_ref || '{\"extra\":true}'::jsonb"]) {
      await expect(database.query(`UPDATE rhiza_anchors SET ${assignment} WHERE id=$1`, [anchor])).rejects.toThrow();
    }
    await expect(database.exec(await readFile('db/migrations/0022_sealed_anchor_content.down.sql', 'utf8'))).rejects.toThrow('Cannot remove sealed anchor references');
    const content = SealedAnchorContent.atDirectory(root);
    const reference = await content.seal(workspace, anchor, { selectedText: 'private quotation' });
    await database.query('UPDATE rhiza_anchors SET content_ref=$2,start_offset=0,end_offset=17 WHERE id=$1', [anchor, JSON.stringify(reference)]);
    const store = new PostgresWorkspaceStore(database, undefined, undefined, undefined, undefined, undefined, undefined, undefined, content);
    expect((await store.forWorkspace(workspace).read()).anchors).toEqual([expect.objectContaining({ id: anchor, nodeId: node, segmentId: segment, selectedText: 'private quotation', startOffset: 0, endOffset: 17 })]);
    await expect(new PostgresWorkspaceStore(database, workspace).read()).rejects.toThrow('ANCHOR_CONTENT_STORE_UNAVAILABLE');
    await content.destroy(workspace, anchor, reference);
    await expect(store.forWorkspace(workspace).read()).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
  } finally { await database.close(); await rm(root, { recursive: true, force: true }); }
}, 30_000);
