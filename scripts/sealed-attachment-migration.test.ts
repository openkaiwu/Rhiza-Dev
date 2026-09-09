// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { loadMigrations } from './migrate';

it('rejects plaintext beside attachment ciphertext and prevents unsafe downgrade', async () => {
  const database = new PGlite();
  try {
    for (const migration of await loadMigrations()) await database.exec(migration.sql);
    const workspace = '00000000-0000-4000-8000-000000000001';
    await database.query("INSERT INTO rhiza_projects(id,title,state) VALUES ($1,'Test','{}')", [workspace]);
    await database.query("INSERT INTO rhiza_attachments(id,project_id,name,mime_type,size_bytes,kind,storage_key) VALUES ('00000000-0000-4000-8000-000000000002',$1,'legacy','text/plain',10,'file','blob')", [workspace]);
    const digest = 'a'.repeat(64);
    const reference = { format: 'rhiza.sealed-attachment.v1', contentId: 'content', reference: {
      version: 1, digest, size: 10, ciphertext: { digestAlgorithm: 'sha256', digest, blobRef: `sha256/aa/${digest}`, size: 39 },
    } };
    const write = (ref: unknown, name = '[sealed]', text: string | null = null, summary: string | null = null) => database.query('UPDATE rhiza_attachments SET content_ref=$1::jsonb,name=$2,extracted_text=$3,summary=$4', [JSON.stringify(ref), name, text, summary]);
    await write(reference);
    await expect(write(reference, 'private')).rejects.toThrow();
    await expect(write(reference, '[sealed]', 'private')).rejects.toThrow();
    await expect(write(reference, '[sealed]', null, 'private')).rejects.toThrow();
    for (const invalid of [null, {}, { ...reference, extra: 'private' }, { ...reference, contentId: '' }, { ...reference, reference: { ...reference.reference, size: -1 } }]) {
      await expect(write(invalid)).rejects.toThrow();
    }
    const down = await readFile('db/migrations/0027_sealed_attachment_content.down.sql', 'utf8');
    await expect(database.exec(down)).rejects.toThrow('Cannot remove sealed attachment references');
    await database.exec("UPDATE rhiza_attachments SET content_ref=NULL,name='legacy',extracted_text='restored'");
    await database.exec(down);
  } finally { await database.close(); }
}, 30_000);
