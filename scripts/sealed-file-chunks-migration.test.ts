// @vitest-environment node
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { expect, it, vi } from 'vitest';
import { loadMigrations } from './migrate';
import { SealedFileChunkContent, fileChunkStorageProjection } from '../server/infrastructure/sealed-file-chunk-content';
import { PostgresWorkspaceStore } from '../server/postgres-store';

it('enforces sealed file chunk projections and protects rollback', async () => {
  const database = new PGlite();
  const root = await mkdtemp(join(tmpdir(), 'rhiza-chunk-sql-'));
  try {
    for (const migration of await loadMigrations()) await database.exec(migration.sql);
    const workspace = '00000000-0000-4000-8000-000000000001';
    await database.query("INSERT INTO rhiza_projects(id,title,state) VALUES ($1,'Test','{}')", [workspace]);
    await database.query("INSERT INTO rhiza_nodes(id,project_id,title,status,kind) VALUES ('00000000-0000-4000-8000-000000000002',$1,'Test','active','main')", [workspace]);
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
    const content = SealedFileChunkContent.atDirectory(root);
    const chunk = { id: item.id, attachmentId: item.attachmentId, ordinal: 0, startOffset: 0, endOffset: 10, tokens: 3, text: 'private text', terms: ['private'], embedding: [0.25] };
    const reference = await content.seal(workspace, chunk.id, chunk);
    await write([fileChunkStorageProjection(chunk, reference)]);
    const store = new PostgresWorkspaceStore(database, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, content).forWorkspace(workspace);
    expect((await store.read()).fileChunks).toEqual([chunk]);
    await expect(new PostgresWorkspaceStore(database, workspace).read()).rejects.toThrow('FILE_CHUNK_CONTENT_STORE_UNAVAILABLE');
    const seal = vi.spyOn(content, 'seal');
    await store.update(current => ({ ...current, fileChunks: current.fileChunks.map(entry => ({ ...entry, tokens: 4 })) }));
    expect(seal).not.toHaveBeenCalled();
    await store.update(current => ({ ...current, fileChunks: current.fileChunks.map(entry => ({ ...entry, text: 'changed', terms: ['changed'], embedding: [0.5] })) }));
    expect(seal).toHaveBeenCalledOnce();
    const updated = await seal.mock.results[0].value;
    expect((await store.read()).fileChunks[0]).toEqual({ ...chunk, tokens: 4, text: 'changed', terms: ['changed'], embedding: [0.5] });
    const stored = (await database.query<{ state: { fileChunks: unknown[] } }>('SELECT state FROM rhiza_projects WHERE id=$1', [workspace])).rows[0].state;
    expect(stored.fileChunks[0]).toMatchObject({ text: '', terms: [], embedding: [], contentRef: updated });
    seal.mockClear();
    await database.exec("CREATE FUNCTION reject_chunk_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected chunk failure'; END $$; CREATE TRIGGER reject_chunk_write BEFORE INSERT ON rhiza_projects FOR EACH ROW EXECUTE FUNCTION reject_chunk_write();");
    await expect(store.update(current => ({ ...current, fileChunks: current.fileChunks.map(entry => ({ ...entry, text: 'failed' })) }))).rejects.toThrow('injected chunk failure');
    await expect(content.read(workspace, chunk.id, await seal.mock.results[0].value)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect((await store.read()).fileChunks[0].text).toBe('changed');
    seal.mockRestore();
    await content.destroy(workspace, chunk.id, updated);
    await expect(store.read()).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await write([{ ...item, contentRef: undefined, text: 'legacy', terms: ['legacy'], embedding: [1] }]);
    await database.exec(down);
  } finally { await database.close(); await rm(root, { recursive: true, force: true }); }
}, 30_000);
