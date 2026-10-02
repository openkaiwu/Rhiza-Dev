// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { NodeSealedContentStore, withVerifiedContentReads } from './node-sealed-content-store';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { NodeContentKeys } from './node-content-keys';

it('verified reads reuse only immutable scoped references, copy bytes, and expire with transaction or revoked keys', async () => {
  const root = await mkdtemp(join(tmpdir(),'rhiza-m17-read-cache-'));
  try {
    const blobs = new NodeFilesystemBlobStore(join(root,'blobs'));
    const content = new NodeSealedContentStore(blobs, new NodeContentKeys(join(root,'keys')));
    const identity = { workspaceId: 'w1', contentId: 'c1' };
    const reference = await content.put(identity, Buffer.from('verified body'));
    const disk = vi.spyOn(blobs,'readStream');
    await withVerifiedContentReads(async () => {
      const [a,b] = await Promise.all([content.read(identity,reference),content.read(identity,reference)]);
      expect(disk).toHaveBeenCalledTimes(1); a.fill(0); expect(Buffer.from(b).toString()).toBe('verified body'); b.fill(0);
      await expect(content.read({ ...identity, workspaceId: 'w2' },reference)).rejects.toThrow();
      await expect(content.read(identity,{ ...reference, digest: 'b'.repeat(64) })).rejects.toThrow('CONTENT_DIGEST_MISMATCH');
      const again = await content.read(identity,reference); expect(Buffer.from(again).toString()).toBe('verified body'); again.fill(0);
    });
    const count = disk.mock.calls.length;
    await withVerifiedContentReads(async () => { const bytes = await content.read(identity,reference); bytes.fill(0); });
    expect(disk.mock.calls.length).toBe(count + 1);
    await withVerifiedContentReads(async () => {
      const bytes = await content.read(identity,reference); bytes.fill(0);
      await content.destroy(identity);
      await expect(content.read(identity,reference)).rejects.toThrow();
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});
