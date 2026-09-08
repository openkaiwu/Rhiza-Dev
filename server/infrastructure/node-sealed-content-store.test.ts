import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { NodeContentKeys } from './node-content-keys';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { NodeSealedContentStore } from './node-sealed-content-store';

it('stores only ciphertext and makes revoked historical documents unreadable after reopening', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-sealed-store-'));
  try {
    const blobs = new NodeFilesystemBlobStore(join(root, 'data'));
    const keys = new NodeContentKeys(join(root, 'keys'));
    const store = new NodeSealedContentStore(blobs, keys);
    const identity = { workspaceId: 'a', contentId: 'document' };
    const other = { workspaceId: 'b', contentId: 'document' };
    const plaintext = Buffer.from('Private historical prompt and response');
    const reference = await store.put(identity, plaintext);
    const copy = await store.put(other, plaintext);
    const encoded = await blobs.read(reference.ciphertext.blobRef, reference.ciphertext.digest);
    expect(Buffer.from(encoded).includes(plaintext)).toBe(false);
    expect(await store.read(identity, reference)).toEqual(plaintext);
    await expect(store.read(other, reference)).rejects.toThrow();
    await expect(store.read(identity, { ...reference, digest: '0'.repeat(64) })).rejects.toThrow('CONTENT_DIGEST_MISMATCH');
    await expect(store.read(identity, { ...reference, size: reference.size + 1 })).rejects.toThrow('CONTENT_REFERENCE_INVALID');
    await store.destroy(identity);
    const reopened = new NodeSealedContentStore(blobs, new NodeContentKeys(join(root, 'keys')));
    await expect(reopened.read(identity, reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await expect(reopened.put(identity, plaintext)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await reopened.read(other, copy)).toEqual(plaintext);
    const failed = { ...identity, contentId: 'failed-publication' };
    const faultyBlobs = new NodeFilesystemBlobStore(join(root, 'faulty'), () => { throw new Error('disk failure'); });
    await expect(new NodeSealedContentStore(faultyBlobs, keys).put(failed, plaintext)).rejects.toThrow('disk failure');
    await expect(keys.read(failed)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    const empty = { ...identity, contentId: 'empty' };
    expect(await store.read(empty, await store.put(empty, new Uint8Array()))).toHaveLength(0);
    const mutable = Buffer.from('original');
    const snapshotIdentity = { ...identity, contentId: 'snapshot' };
    const pending = store.put(snapshotIdentity, mutable);
    mutable.fill(0);
    expect(await store.read(snapshotIdentity, await pending)).toEqual(Buffer.from('original'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
