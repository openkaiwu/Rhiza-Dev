import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { SealedEdgeContent } from './sealed-edge-content';

it('seals only relationship labels and isolates revocation by workspace and edge', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-edge-content-'));
  try {
    const content = SealedEdgeContent.atDirectory(root);
    const value = { label: 'private relation label', source: 'source', target: 'target' };
    const reference = await content.seal('a', 'edge', value);
    const other = await content.seal('b', 'edge', value);
    expect(await SealedEdgeContent.atDirectory(root).read('a', 'edge', reference)).toEqual({ label: value.label });
    await expect(content.read('b', 'edge', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await expect(content.read('a', 'different', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    const empty = await content.seal('a', 'empty', { label: '' });
    expect(await content.read('a', 'empty', empty)).toEqual({ label: '' });
    await content.destroy('a', 'edge', reference);
    await expect(content.read('a', 'edge', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect(await content.read('b', 'edge', other)).toEqual({ label: value.label });
  } finally { await rm(root, { recursive: true, force: true }); }
});
