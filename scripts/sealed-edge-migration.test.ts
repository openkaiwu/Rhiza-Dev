// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { loadMigrations } from './migrate';

it('rejects plaintext alongside edge ciphertext and preserves endpoint constraints', async () => {
  const database = new PGlite();
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
  } finally { await database.close(); }
}, 30_000);
