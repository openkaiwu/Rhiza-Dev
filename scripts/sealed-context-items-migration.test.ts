// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { loadMigrations } from './migrate';

it('rejects plaintext and malformed metadata in encrypted context item projections', async () => {
  const database = new PGlite();
  try {
    for (const migration of await loadMigrations()) await database.exec(migration.sql);
    const workspace = '00000000-0000-4000-8000-000000000001';
    await database.query("INSERT INTO rhiza_projects(id,title,state) VALUES ($1,'Test','{}')", [workspace]);
    const digest = 'a'.repeat(64);
    const contentRef = { format: 'rhiza.sealed-context-item.v1', contentId: 'content', reference: {
      version: 1, digest, size: 10, ciphertext: { digestAlgorithm: 'sha256', digest, blobRef: `sha256/aa/${digest}`, size: 39 },
    } };
    const item = { id: 'item', title: '', detail: '', role: 'Reference', status: 'active', tokens: 10, contentRef };
    const write = (value: unknown) => database.query('UPDATE rhiza_projects SET state=$2 WHERE id=$1', [workspace, JSON.stringify({ contextItems: [value] })]);
    await write(item);
    for (const patch of [{ title: 'private' }, { detail: 'private' }, { reason: '' }, { content: '' }, { extra: 'private' }, { contentRef: {} }, { contentRef: null }, { sourceId: { secret: true } }, { pinned: null }, { selectionMode: null }, { role: 'invalid' }]) {
      await expect(write({ ...item, ...patch })).rejects.toThrow();
    }
    await expect(database.exec(await readFile('db/migrations/0025_sealed_context_items.down.sql', 'utf8'))).rejects.toThrow('Cannot remove sealed context item protection');
    await write({ id: 'legacy', title: 'legacy plaintext' });
    await database.exec(await readFile('db/migrations/0025_sealed_context_items.down.sql', 'utf8'));
  } finally { await database.close(); }
}, 30_000);
