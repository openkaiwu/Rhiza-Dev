import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { SealedAnchorContent } from './sealed-anchor-content';

it('seals only anchor text, preserving absent and empty text with scoped revocation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-anchor-content-'));
  try {
    const content = SealedAnchorContent.atDirectory(root);
    const original = { selectedText: 'private quotation', messageId: 'association' };
    const reference = await content.seal('a', 'anchor', original);
    const other = await content.seal('b', 'anchor', original);
    expect(await SealedAnchorContent.atDirectory(root).read('a', 'anchor', reference)).toEqual({ selectedText: original.selectedText });
    await expect(content.read('b', 'anchor', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await expect(content.read('a', 'different', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    for (const value of [{}, { selectedText: '' }]) {
      const ref = await content.seal('a', 'empty', value);
      expect(await content.read('a', 'empty', ref)).toEqual(value);
    }
    await content.destroy('a', 'anchor', reference);
    await expect(content.read('a', 'anchor', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect(await content.read('b', 'anchor', other)).toEqual({ selectedText: original.selectedText });
  } finally { await rm(root, { recursive: true, force: true }); }
});
