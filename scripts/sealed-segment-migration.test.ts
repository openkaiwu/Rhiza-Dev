// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { loadMigrations } from './migrate';

it('rejects plaintext alongside segment ciphertext and preserves relational constraints', async () => {
  const database = new PGlite();
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
  } finally { await database.close(); }
}, 30_000);
