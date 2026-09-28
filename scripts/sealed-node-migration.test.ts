// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { loadMigrations } from './migrate';

it('requires a strict sealed node reference and rejects retained plaintext or lossy rollback', async () => {
  const database = new PGlite();
  try {
    for (const migration of await loadMigrations()) await database.exec(migration.sql);
    const workspace = '00000000-0000-4000-8000-000000000001';
    const node = '00000000-0000-4000-8000-000000000002';
    await database.query('INSERT INTO rhiza_projects(id,title,state) VALUES ($1,$2,$3)', [workspace, 'Test', '{}']);
    const digest = 'a'.repeat(64);
    const reference = { format: 'rhiza.sealed-node.v1', contentId: 'content', reference: {
      version: 1, digest, size: 10, ciphertext: { digestAlgorithm: 'sha256', digest, blobRef: `sha256/aa/${digest}`, size: 39 },
    } };
    await database.query("INSERT INTO rhiza_nodes(id,project_id,title,summary,status,kind,content_ref) VALUES ($1,$2,'[sealed]','','active','main',$3)", [node, workspace, JSON.stringify(reference)]);
    for (const assignment of ["title='private'", "summary='private'", "anchor_text='private'", "content_ref='{}'::jsonb", "content_ref=content_ref || '{\"extra\":\"private\"}'::jsonb"]) {
      await expect(database.query(`UPDATE rhiza_nodes SET ${assignment} WHERE id=$1`, [node])).rejects.toThrow();
    }
    await expect(database.exec(await readFile('db/migrations/0021_sealed_node_content.down.sql', 'utf8')))
      .rejects.toThrow('Cannot remove sealed node references');
    expect((await database.query('SELECT title,summary,anchor_text FROM rhiza_nodes WHERE id=$1', [node])).rows)
      .toEqual([{ title: '[sealed]', summary: '', anchor_text: null }]);
  } finally { await database.close(); }
}, 30_000);
