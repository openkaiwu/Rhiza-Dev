// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { loadMigrations } from './migrate';

it('enforces sealed file chunk projections and protects rollback', async () => {
  const database = new PGlite();
  try {
    for (const migration of await loadMigrations()) await database.exec(migration.sql);
    const workspace = '00000000-0000-4000-8000-000000000001';
    await database.query("INSERT INTO rhiza_projects(id,title,state) VALUES ($1,'Test','{}')", [workspace]);
    const digest = 'a'.repeat(64);
    const contentRef = { format: 'rhiza.sealed-file-chunk.v1', contentId: 'content', reference: {
      version: 1, digest, size: 10, ciphertext: { digestAlgorithm: 'sha256', digest, blobRef: `sha256/aa/${digest}`, size: 39 },
    } };
    const item = { id: 'chunk', attachmentId: 'attachment', ordinal: 0, startOffset: 0, endOffset: 10, tokens: 3, text: '', terms: [], embedding: [], contentRef };
    const write = (fileChunks: unknown) => database.query('UPDATE rhiza_projects SET state=$2 WHERE id=$1', [workspace, JSON.stringify({ fileChunks })]);
    await write([item]);
    for (const patch of [
      { text: 'private' }, { terms: ['private'] }, { embedding: [1] }, { extra: 'private' },
      { contentRef: null }, { contentRef: {} }, { id: '' }, { attachmentId: null },
      { ordinal: -1 }, { tokens: 0.5 }, { startOffset: 11 }, { endOffset: null },
      { resourceVersionId: {} }, { text: null }, { terms: null }, { embedding: null },
    ]) await expect(write([{ ...item, ...patch }])).rejects.toThrow();
    await expect(write({})).rejects.toThrow();
    await expect(write(null)).rejects.toThrow();
    const down = await readFile('db/migrations/0026_sealed_file_chunks.down.sql', 'utf8');
    await expect(database.exec(down)).rejects.toThrow('Cannot remove sealed file chunk protection');
    await write([{ ...item, contentRef: undefined, text: 'legacy', terms: ['legacy'], embedding: [1] }]);
    await database.exec(down);
  } finally { await database.close(); }
}, 30_000);
