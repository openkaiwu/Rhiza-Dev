import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { SealedResourceContent } from './sealed-resource-content';

it('seals only resource names with workspace and resource identity isolation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-resource-content-'));
  try {
    const content = SealedResourceContent.atDirectory(root);
    const value = { logicalName: 'private resource name', kind: 'attachment', extra: 'excluded' };
    const reference = await content.seal('a', 'resource', value);
    const other = await content.seal('b', 'resource', value);
    expect(await SealedResourceContent.atDirectory(root).read('a', 'resource', reference)).toEqual({ logicalName: value.logicalName });
    await expect(content.read('b', 'resource', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await expect(content.read('a', 'different', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    const empty = await content.seal('a', 'empty', { logicalName: '' });
    expect(await content.read('a', 'empty', empty)).toEqual({ logicalName: '' });
    await content.destroy('a', 'resource', reference);
    await expect(content.read('a', 'resource', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect(await content.read('b', 'resource', other)).toEqual({ logicalName: value.logicalName });
  } finally { await rm(root, { recursive: true, force: true }); }
});
