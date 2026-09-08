// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { loadMigrations } from './migrate';

it('requires an association for sealed anchor text and refuses plaintext coexistence or lossy rollback', async () => {
  const database = new PGlite();
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
  } finally { await database.close(); }
}, 30_000);
