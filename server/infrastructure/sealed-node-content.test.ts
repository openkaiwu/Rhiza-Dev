import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { SealedNodeContent } from './sealed-node-content';

it('preserves node content across reopen and binds keys to workspace and node identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-node-content-'));
  try {
    const content = SealedNodeContent.atDirectory(root);
    const node = { title: 'private title', summary: 'private summary', anchorText: 'private quotation', status: 'active' };
    const reference = await content.seal('a', 'node', node);
    const other = await content.seal('b', 'node', node);
    expect(await SealedNodeContent.atDirectory(root).read('a', 'node', reference))
      .toEqual({ title: node.title, summary: node.summary, anchorText: node.anchorText });
    await expect(content.read('b', 'node', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await expect(content.read('a', 'different', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await content.destroy('a', 'node', reference);
    await expect(content.read('a', 'node', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect((await content.read('b', 'node', other)).title).toBe(node.title);
  } finally { await rm(root, { recursive: true, force: true }); }
});
