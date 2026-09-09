// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { loadMigrations } from './migrate';

it('protects sealed resource names and refuses unsafe downgrade', async () => {
  const database = new PGlite();
  try {
    for (const migration of await loadMigrations()) await database.exec(migration.sql);
    const workspace = '00000000-0000-4000-8000-000000000001';
    await database.query("INSERT INTO rhiza_projects(id,title,state) VALUES ($1,'Test','{}')", [workspace]);
    await database.query("INSERT INTO rhiza_resources(resource_id,workspace_id,kind,logical_name) VALUES ('resource',$1,'attachment','legacy')", [workspace]);
    const digest = 'a'.repeat(64);
    const reference = { format: 'rhiza.sealed-resource.v1', contentId: 'content', reference: {
      version: 1, digest, size: 10, ciphertext: { digestAlgorithm: 'sha256', digest, blobRef: `sha256/aa/${digest}`, size: 39 },
    } };
    const write = (ref: unknown, name = '[sealed]') => database.query('UPDATE rhiza_resources SET content_ref=$1::jsonb,logical_name=$2', [JSON.stringify(ref), name]);
    await write(reference);
    await expect(write(reference, 'private')).rejects.toThrow();
    for (const invalid of [null, {}, { ...reference, extra: 'private' }, { ...reference, contentId: '' }, { ...reference, reference: { ...reference.reference, size: -1 } }]) await expect(write(invalid)).rejects.toThrow();
    const down = await readFile('db/migrations/0028_sealed_resource_content.down.sql', 'utf8');
    await expect(database.exec(down)).rejects.toThrow('Cannot remove sealed resource references');
    await database.exec("UPDATE rhiza_resources SET content_ref=NULL,logical_name='restored'");
    await database.exec(down);
  } finally { await database.close(); }
}, 30_000);
