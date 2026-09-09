import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { SealedSegmentContent } from './sealed-segment-content';

it('seals only segment titles with workspace and segment identity isolation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-segment-content-'));
  try {
    const content = SealedSegmentContent.atDirectory(root);
    const value = { title: 'private title', ordinal: 7, nodeId: 'node' };
    const reference = await content.seal('a', 'segment', value);
    const other = await content.seal('b', 'segment', value);
    expect(await SealedSegmentContent.atDirectory(root).read('a', 'segment', reference)).toEqual({ title: value.title });
    await expect(content.read('b', 'segment', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await expect(content.read('a', 'different', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    const empty = await content.seal('a', 'empty', { title: '' });
    expect(await content.read('a', 'empty', empty)).toEqual({ title: '' });
    await content.destroy('a', 'segment', reference);
    await expect(content.read('a', 'segment', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect(await content.read('b', 'segment', other)).toEqual({ title: value.title });
  } finally { await rm(root, { recursive: true, force: true }); }
});
