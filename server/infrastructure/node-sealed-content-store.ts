import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BlobPutResult } from '../application/ports/host-runtime';
import { NodeContentKeys } from './node-content-keys';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { associatedData, openContent, sealContent, type ContentIdentity } from './sealed-content';

export interface SealedContentRef { version: 1; digest: string; size: number; ciphertext: BlobPutResult }
const maxDocumentBytes = 64 * 1024 ** 2;
const headerBytes = 29; // version + 12-byte nonce + 16-byte authentication tag
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Scoped encrypted documents and resource streams. */
export class NodeSealedContentStore {
  constructor(private readonly blobs: NodeFilesystemBlobStore, private readonly keys: NodeContentKeys, private readonly temporaryRoot = tmpdir()) {}

  auditKeys(identities: Iterable<ContentIdentity>) { return this.keys.audit(identities); }

  /** Maintenance only; caller holds exclusive publication ownership throughout. */
  revokeUnreferencedKeys(identities: Iterable<ContentIdentity>) { return this.keys.revokeUnreferenced(identities); }

  /** Streaming publication; the bounded document reader remains limited to 64 MiB. */
  async putStream(identity: ContentIdentity, plaintext: AsyncIterable<Uint8Array>, expectedSize: number, expectedDigest?: string): Promise<SealedContentRef> {
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > 2 * 1024 ** 3) throw new Error('CONTENT_SIZE_INVALID');
    let key: Buffer | undefined;
    let created = false;
    try {
      if (expectedDigest) {
        const publication = await this.keys.createOrRead(identity, expectedDigest);
        key = publication.key; created = publication.created;
      } else { key = await this.keys.create(identity); created = true; }
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
      cipher.setAAD(associatedData(identity));
      const hash = createHash('sha256');
      async function* encrypt() {
        let size = 0;
        for await (const chunk of plaintext) {
          size += chunk.byteLength;
          if (size > expectedSize) throw new Error('CONTENT_SIZE_MISMATCH');
          hash.update(chunk);
          yield cipher.update(chunk);
        }
        if (size !== expectedSize) throw new Error('CONTENT_SIZE_MISMATCH');
        yield cipher.final();
      }
      // The existing v1 header precedes ciphertext, but its tag is available only after final().
      // Stage ciphertext alone, then stream the header and ciphertext into the final object.
      // Both objects are encrypted; the unreferenced intermediate follows ordinary grace-period GC.
      const staged = await this.blobs.putStream(encrypt(), undefined, expectedSize);
      const blobs = this.blobs;
      const header = Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag()]);
      async function* envelope() {
        yield header;
        yield* blobs.readStream(staged.blobRef, staged.digest);
      }
      const ciphertext = await blobs.putStream(envelope(), undefined, expectedSize + headerBytes);
      const plaintextDigest = hash.digest('hex');
      if (expectedDigest && plaintextDigest !== expectedDigest) throw new Error('CONTENT_DIGEST_MISMATCH');
      return { version: 1, digest: plaintextDigest, size: expectedSize, ciphertext };
    } catch (error) {
      try {
        if (key && created) {
          if (expectedDigest) await this.keys.abortPublication(identity, expectedDigest);
          else await this.keys.destroy(identity);
        }
      }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'CONTENT_PUBLICATION_CLEANUP_FAILED', { cause: cleanup }); }
      throw error;
    } finally { key?.fill(0); }
  }

  async put(identity: ContentIdentity, plaintext: Uint8Array): Promise<SealedContentRef> {
    if (plaintext.byteLength > maxDocumentBytes) throw new Error('CONTENT_DOCUMENT_TOO_LARGE');
    const content = Buffer.from(plaintext);
    let key: Buffer | undefined;
    try {
      key = await this.keys.create(identity);
      const sealed = sealContent(identity, content, key);
      const ciphertext = await this.blobs.put(Buffer.concat([Buffer.from([sealed.version]), sealed.iv, sealed.tag, sealed.ciphertext]));
      return { version: 1, digest: digest(content), size: content.byteLength, ciphertext };
    } catch (error) {
      // Failed publication must not leave an accessible data key behind.
      try { if (key) await this.keys.destroy(identity); }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'CONTENT_PUBLICATION_CLEANUP_FAILED', { cause: cleanup }); }
      throw error;
    } finally { key?.fill(0); content.fill(0); }
  }

  /** Authenticate the whole source before releasing any plaintext, using an encrypted temporary spool. */
  async *readStream(identity: ContentIdentity, reference: SealedContentRef): AsyncIterable<Uint8Array> {
    if (reference.version !== 1 || !Number.isSafeInteger(reference.size) || reference.size < 0 || reference.size > 2 * 1024 ** 3
      || reference.ciphertext.size !== reference.size + headerBytes || !/^[a-f0-9]{64}$/.test(reference.digest)) throw new Error('CONTENT_REFERENCE_INVALID');
    const key = await this.keys.read(identity);
    const temporaryKey = randomBytes(32);
    let directory: string | undefined;
    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      directory = await mkdtemp(join(this.temporaryRoot, 'rhiza-verified-content-'));
      file = await open(join(directory, 'encrypted'), 'wx+', 0o600);
      const frames: number[] = [];
      const hash = createHash('sha256');
      const spool = async (plain: Buffer) => {
        try {
          hash.update(plain);
          const sealed = sealContent({ ...identity, contentId: `${identity.contentId}:${frames.length}` }, plain, temporaryKey);
          const frame = Buffer.concat([sealed.iv, sealed.tag, sealed.ciphertext]);
          await file!.writeFile(frame);
          frames.push(frame.length);
        } finally { plain.fill(0); }
      };
      let header = Buffer.alloc(0);
      let size = 0;
      let decipher: ReturnType<typeof createDecipheriv> | undefined;
      for await (const chunk of this.blobs.readStream(reference.ciphertext.blobRef, reference.ciphertext.digest)) {
        size += chunk.byteLength;
        if (size > reference.ciphertext.size) throw new Error('CONTENT_SIZE_MISMATCH');
        let body = Buffer.from(chunk);
        if (!decipher) {
          const needed = headerBytes - header.length;
          header = Buffer.concat([header, body.subarray(0, needed)]);
          body = body.subarray(needed);
          if (header.length < headerBytes) continue;
          if (header[0] !== 1) throw new Error('CONTENT_ENVELOPE_INVALID');
          const gcm = createDecipheriv('aes-256-gcm', key, header.subarray(1, 13), { authTagLength: 16 });
          gcm.setAAD(associatedData(identity));
          gcm.setAuthTag(header.subarray(13, 29));
          decipher = gcm;
        }
        await spool(decipher.update(body));
      }
      if (size !== reference.ciphertext.size || !decipher) throw new Error('CONTENT_SIZE_MISMATCH');
      await spool(decipher.final());
      if (hash.digest('hex') !== reference.digest) throw new Error('CONTENT_DIGEST_MISMATCH');
      key.fill(0);
      let position = 0;
      for (let index = 0; index < frames.length; index++) {
        const frame = Buffer.alloc(frames[index]);
        let offset = 0;
        while (offset < frame.length) {
          const { bytesRead } = await file.read(frame, offset, frame.length - offset, position + offset);
          if (!bytesRead) throw new Error('CONTENT_SPOOL_TRUNCATED');
          offset += bytesRead;
        }
        position += frame.length;
        // A paused consumer must not keep reading the spool after the source key is revoked.
        // Cross-process Purge still requires publication/read ownership coordination.
        const currentKey = await this.keys.read(identity);
        currentKey.fill(0);
        yield openContent({ ...identity, contentId: `${identity.contentId}:${index}` }, {
          version: 1, iv: frame.subarray(0, 12), tag: frame.subarray(12, 28), ciphertext: frame.subarray(28),
        }, temporaryKey);
      }
    } finally {
      key.fill(0); temporaryKey.fill(0);
      try { await file?.close(); }
      finally { if (directory) await rm(directory, { recursive: true, force: true }); }
    }
  }

  async read(identity: ContentIdentity, reference: SealedContentRef): Promise<Uint8Array> {
    if (reference.version !== 1 || !Number.isSafeInteger(reference.size) || reference.size < 0 || reference.size > maxDocumentBytes
      || reference.ciphertext.size !== reference.size + headerBytes || !/^[a-f0-9]{64}$/.test(reference.digest)) throw new Error('CONTENT_REFERENCE_INVALID');
    const key = await this.keys.read(identity);
    try {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of this.blobs.readStream(reference.ciphertext.blobRef, reference.ciphertext.digest)) {
        size += chunk.byteLength;
        if (size > reference.ciphertext.size) throw new Error('CONTENT_SIZE_MISMATCH');
        chunks.push(chunk);
      }
      if (size !== reference.ciphertext.size) throw new Error('CONTENT_SIZE_MISMATCH');
      const encoded = Buffer.concat(chunks);
      if (encoded[0] !== 1) throw new Error('CONTENT_ENVELOPE_INVALID');
      const plaintext = openContent(identity, { version: 1, iv: encoded.subarray(1, 13), tag: encoded.subarray(13, 29), ciphertext: encoded.subarray(29) }, key);
      if (digest(plaintext) !== reference.digest) {
        plaintext.fill(0);
        throw new Error('CONTENT_DIGEST_MISMATCH');
      }
      return plaintext;
    } finally { key.fill(0); }
  }

  destroy(identity: ContentIdentity): Promise<void> { return this.keys.destroy(identity); }
}
