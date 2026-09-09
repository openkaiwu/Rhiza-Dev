import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import type { BlobPutResult } from '../application/ports/host-runtime';
import { NodeContentKeys } from './node-content-keys';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { associatedData, openContent, sealContent, type ContentIdentity } from './sealed-content';

export interface SealedContentRef { version: 1; digest: string; size: number; ciphertext: BlobPutResult }
const maxDocumentBytes = 64 * 1024 ** 2;
const headerBytes = 29; // version + 12-byte nonce + 16-byte authentication tag
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Bounded historical documents. Large resource streams need their own streaming codec. */
export class NodeSealedContentStore {
  constructor(private readonly blobs: NodeFilesystemBlobStore, private readonly keys: NodeContentKeys) {}

  auditKeys(identities: Iterable<ContentIdentity>) { return this.keys.audit(identities); }

  /** Maintenance only; caller holds exclusive publication ownership throughout. */
  revokeUnreferencedKeys(identities: Iterable<ContentIdentity>) { return this.keys.revokeUnreferenced(identities); }

  /** Streaming publication; the bounded document reader remains limited to 64 MiB. */
  async putStream(identity: ContentIdentity, plaintext: AsyncIterable<Uint8Array>, expectedSize: number): Promise<SealedContentRef> {
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > 2 * 1024 ** 3) throw new Error('CONTENT_SIZE_INVALID');
    let key: Buffer | undefined;
    try {
      key = await this.keys.create(identity);
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
      return { version: 1, digest: hash.digest('hex'), size: expectedSize, ciphertext };
    } catch (error) {
      try { if (key) await this.keys.destroy(identity); }
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
