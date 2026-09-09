import { mkdtemp, rm } from 'node:fs/promises';
import { createDecipheriv, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { NodeContentKeys } from './node-content-keys';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { NodeSealedContentStore } from './node-sealed-content-store';
import { associatedData } from './sealed-content';

it('publishes and authenticates a 65 MiB stream without the document reader', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-sealed-large-'));
  const keys = new NodeContentKeys(join(root, 'keys'));
  const blobs = new NodeFilesystemBlobStore(join(root, 'data'));
  const store = new NodeSealedContentStore(blobs, keys);
  const identity = { workspaceId: 'workspace', contentId: 'large-stream' };
  const chunk = Buffer.alloc(1024 ** 2, 37);
  const expectedHash = createHash('sha256');
  async function* source() { for (let index = 0; index < 65; index++) { expectedHash.update(chunk); yield chunk; } }
  try {
    const reference = await store.putStream(identity, source(), 65 * chunk.length);
    expect(reference.size).toBe(65 * chunk.length);
    expect(reference.digest).toBe(expectedHash.digest('hex'));
    expect(reference.ciphertext.size).toBe(reference.size + 29);
    const key = await keys.read(identity);
    const hash = createHash('sha256');
    let size = 0;
    let header = Buffer.alloc(0);
    let decipher: ReturnType<typeof createDecipheriv> | undefined;
    try {
      for await (const encoded of blobs.readStream(reference.ciphertext.blobRef, reference.ciphertext.digest)) {
        let body = Buffer.from(encoded);
        if (!decipher) {
          const needed = 29 - header.length;
          header = Buffer.concat([header, body.subarray(0, needed)]);
          body = body.subarray(needed);
          if (header.length < 29) continue;
          expect(header[0]).toBe(1);
          const gcm = createDecipheriv('aes-256-gcm', key, header.subarray(1, 13), { authTagLength: 16 });
          gcm.setAAD(associatedData(identity));
          gcm.setAuthTag(header.subarray(13, 29));
          decipher = gcm;
        }
        const plain = decipher.update(body);
        size += plain.length;
        hash.update(plain);
        plain.fill(0);
      }
      const final = decipher!.final();
      hash.update(final); size += final.length; final.fill(0);
      expect(size).toBe(reference.size);
      expect(hash.digest('hex')).toBe(reference.digest);
    } finally { key.fill(0); }
    const streamedHash = createHash('sha256');
    let streamedSize = 0;
    for await (const plain of store.readStream(identity, reference)) {
      streamedHash.update(plain);
      streamedSize += plain.length;
      plain.fill(0);
    }
    expect(streamedSize).toBe(reference.size);
    expect(streamedHash.digest('hex')).toBe(reference.digest);
    const failed = { ...identity, contentId: 'interrupted' };
    async function* interrupted() { yield chunk; throw new Error('source interrupted'); }
    await expect(store.putStream(failed, interrupted(), 2 * chunk.length)).rejects.toThrow('source interrupted');
    await expect(keys.read(failed)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30000);

it('streams scoped ciphertext compatible with v1 and revokes failed publications', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-sealed-stream-'));
  const keys = new NodeContentKeys(join(root, 'keys'));
  const blobs = new NodeFilesystemBlobStore(join(root, 'data'));
  const store = new NodeSealedContentStore(blobs, keys);
  const bytes = Buffer.from('private streamed original attachment');
  async function* chunks() { yield bytes.subarray(0, 5); yield bytes.subarray(5); }
  const identity = { workspaceId: 'workspace', contentId: 'stream' };
  try {
    const reference = await store.putStream(identity, chunks(), bytes.length);
    expect(await store.read(identity, reference)).toEqual(bytes);
    const invalidDigest = store.readStream(identity, { ...reference, digest: '0'.repeat(64) })[Symbol.asyncIterator]();
    await expect(invalidDigest.next()).rejects.toThrow('CONTENT_DIGEST_MISMATCH');
    const corrupt = Buffer.from(await blobs.read(reference.ciphertext.blobRef, reference.ciphertext.digest));
    corrupt[13] ^= 1;
    const invalidTag = store.readStream(identity, { ...reference, ciphertext: await blobs.put(corrupt) })[Symbol.asyncIterator]();
    await expect(invalidTag.next()).rejects.toThrow();
    expect(Buffer.from(await blobs.read(reference.ciphertext.blobRef, reference.ciphertext.digest)).includes(bytes)).toBe(false);
    await expect(store.putStream(identity, chunks(), bytes.length)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await store.read(identity, reference)).toEqual(bytes);
    for (const size of [bytes.length - 1, bytes.length + 1]) {
      const failed = { ...identity, contentId: `failed-${size}` };
      await expect(store.putStream(failed, chunks(), size)).rejects.toThrow('CONTENT_SIZE_MISMATCH');
      await expect(keys.read(failed)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    }
    const empty = { ...identity, contentId: 'empty-stream' };
    expect(await store.read(empty, await store.putStream(empty, (async function* () {})(), 0))).toHaveLength(0);
    await store.destroy(identity);
    await expect(store.read(identity, reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('clears its plaintext copy when key creation fails without revoking an existing key', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-sealed-failure-'));
  const keys = new NodeContentKeys(join(root, 'keys'));
  const store = new NodeSealedContentStore(new NodeFilesystemBlobStore(join(root, 'data')), keys);
  const identity = { workspaceId: 'workspace', contentId: 'existing' };
  const plaintext = Buffer.from('private snapshot');
  try {
    const reference = await store.put(identity, plaintext);
    const fill = vi.spyOn(Buffer.prototype, 'fill');
    const destroy = vi.spyOn(keys, 'destroy');
    try {
      await expect(store.put(identity, plaintext)).rejects.toMatchObject({ code: 'EEXIST' });
      expect(fill.mock.contexts.some(buffer => Buffer.isBuffer(buffer) && buffer !== plaintext && buffer.length === plaintext.length && buffer.every(byte => byte === 0))).toBe(true);
      expect(destroy).not.toHaveBeenCalled();
    } finally { fill.mockRestore(); destroy.mockRestore(); }
    expect(plaintext.toString()).toBe('private snapshot');
    const clear = vi.spyOn(Buffer.prototype, 'fill');
    try {
      await expect(store.read(identity, { ...reference, digest: '0'.repeat(64) })).rejects.toThrow('CONTENT_DIGEST_MISMATCH');
      expect(clear.mock.contexts.some(buffer => Buffer.isBuffer(buffer) && buffer.length === plaintext.length && buffer.every(byte => byte === 0))).toBe(true);
    } finally { clear.mockRestore(); }
    expect(await store.read(identity, reference)).toEqual(plaintext);
  } finally { await rm(root, { recursive: true, force: true }); }
});

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
