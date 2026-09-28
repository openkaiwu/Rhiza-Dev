import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { SealedFileChunkContent, fileChunkStorageProjection } from './sealed-file-chunk-content';

it('seals chunk text and derived content while retaining only reference metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-chunk-content-'));
  try {
    const content = SealedFileChunkContent.atDirectory(root);
    const value = { id: 'chunk', attachmentId: 'attachment', ordinal: 0, startOffset: 0, endOffset: 12, tokens: 3, text: 'private text', terms: ['private', 'text'], embedding: [0.25, -0.5] };
    const expected = { text: value.text, terms: value.terms, embedding: value.embedding };
    const reference = await content.seal('a', value.id, value);
    const other = await content.seal('b', value.id, value);
    expect(await SealedFileChunkContent.atDirectory(root).read('a', value.id, reference)).toEqual(expected);
    const projection = fileChunkStorageProjection({ ...value, ...{ extra: 'private extra' } }, reference);
    expect(projection).toMatchObject({ id: value.id, attachmentId: value.attachmentId, ordinal: 0, startOffset: 0, endOffset: 12, tokens: 3, text: '', terms: [], embedding: [], contentRef: reference });
    expect(JSON.stringify(projection)).not.toContain('private');
    await expect(content.read('b', value.id, reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await expect(content.read('a', 'different', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await content.destroy('a', value.id, reference);
    await expect(content.read('a', value.id, reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect(await content.read('b', value.id, other)).toEqual(expected);
  } finally { await rm(root, { recursive: true, force: true }); }
});
