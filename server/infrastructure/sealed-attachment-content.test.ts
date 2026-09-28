import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { SealedAttachmentContent } from './sealed-attachment-content';

it('persists attachment authored fields with scoped revocable keys', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-attachment-content-'));
  try {
    const content = SealedAttachmentContent.atDirectory(root);
    const value = { name: 'private.txt', extractedText: 'private text', summary: 'private summary', extra: 'excluded' };
    const expected = { name: value.name, extractedText: value.extractedText, summary: value.summary };
    const reference = await content.seal('a', 'attachment', value);
    const other = await content.seal('b', 'attachment', value);
    expect(await SealedAttachmentContent.atDirectory(root).read('a', 'attachment', reference)).toEqual(expected);
    await expect(content.read('b', 'attachment', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await expect(content.read('a', 'different', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    for (const item of [{ name: '' }, { name: 'empty', extractedText: '', summary: '' }]) {
      const ref = await content.seal('a', 'empty', item);
      expect(await content.read('a', 'empty', ref)).toEqual(item);
    }
    await content.destroy('a', 'attachment', reference);
    await expect(content.read('a', 'attachment', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect(await content.read('b', 'attachment', other)).toEqual(expected);
  } finally { await rm(root, { recursive: true, force: true }); }
});
