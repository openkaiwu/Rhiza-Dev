import { createHash } from 'node:crypto';
import type { BlobPutResult } from '../application/ports/host-runtime';
import { NodeContentKeys } from './node-content-keys';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { openContent, sealContent, type ContentIdentity } from './sealed-content';

export interface SealedContentRef { version: 1; digest: string; size: number; ciphertext: BlobPutResult }
const maxDocumentBytes = 64 * 1024 ** 2;
const headerBytes = 29; // version + 12-byte nonce + 16-byte authentication tag
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Bounded historical documents. Large resource streams need their own streaming codec. */
export class NodeSealedContentStore {
  constructor(private readonly blobs: NodeFilesystemBlobStore, private readonly keys: NodeContentKeys) {}

  async put(identity: ContentIdentity, plaintext: Uint8Array): Promise<SealedContentRef> {
    if (plaintext.byteLength > maxDocumentBytes) throw new Error('CONTENT_DOCUMENT_TOO_LARGE');
    const content = Buffer.from(plaintext);
    const key = await this.keys.create(identity);
    try {
      const sealed = sealContent(identity, content, key);
      const ciphertext = await this.blobs.put(Buffer.concat([Buffer.from([sealed.version]), sealed.iv, sealed.tag, sealed.ciphertext]));
      return { version: 1, digest: digest(content), size: content.byteLength, ciphertext };
    } catch (error) {
      // Failed publication must not leave an accessible data key behind.
      try { await this.keys.destroy(identity); }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'CONTENT_PUBLICATION_CLEANUP_FAILED', { cause: cleanup }); }
      throw error;
    } finally { key.fill(0); content.fill(0); }
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
      if (digest(plaintext) !== reference.digest) throw new Error('CONTENT_DIGEST_MISMATCH');
      return plaintext;
    } finally { key.fill(0); }
  }

  destroy(identity: ContentIdentity): Promise<void> { return this.keys.destroy(identity); }
}
