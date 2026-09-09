import type { BlobContentIdentity, BlobPutResult, BlobStorePort } from '../application/ports/host-runtime';
import { NodeSealedContentStore, type SealedContentRef } from './node-sealed-content-store';

/** Explicit encrypted composition; legacy references must be migrated before selecting this adapter. */
export class NodeEncryptedBlobStore implements BlobStorePort {
  constructor(private readonly content: NodeSealedContentStore) {}

  async put(bytes: Uint8Array, identity?: BlobContentIdentity): Promise<BlobPutResult> {
    if (!identity?.workspaceId || !identity.contentId) throw new Error('CONTENT_IDENTITY_REQUIRED');
    const prefix = `sealed-v1/${encodeURIComponent(identity.workspaceId)}/${encodeURIComponent(identity.contentId)}`;
    if (prefix.length > 1024) throw new Error('CONTENT_IDENTITY_INVALID');
    const reference = await this.content.putStream(identity, (async function* () { yield bytes; })(), bytes.length);
    return { digestAlgorithm: 'sha256', digest: reference.digest, size: reference.size,
      blobRef: `${prefix}/${reference.ciphertext.digest}/${reference.digest}/${reference.size}` };
  }

  private decode(blobRef: string, expectedDigest: string): { identity: BlobContentIdentity; reference: SealedContentRef } {
    if (blobRef.length > 2048) throw new Error('CONTENT_REFERENCE_INVALID');
    const parts = blobRef.split('/');
    if (parts.length !== 6 || parts[0] !== 'sealed-v1' || !parts[1] || !parts[2]
      || !/^[a-f0-9]{64}$/.test(parts[3]) || !/^[a-f0-9]{64}$/.test(parts[4])
      || parts[4] !== expectedDigest || !/^(0|[1-9][0-9]*)$/.test(parts[5])) throw new Error('CONTENT_REFERENCE_INVALID');
    const size = Number(parts[5]);
    if (!Number.isSafeInteger(size) || size > 2 * 1024 ** 3) throw new Error('CONTENT_REFERENCE_INVALID');
    const identity = { workspaceId: decodeURIComponent(parts[1]), contentId: decodeURIComponent(parts[2]) };
    return { identity, reference: { version: 1, digest: expectedDigest, size, ciphertext: {
      digestAlgorithm: 'sha256', digest: parts[3], size: size + 29, blobRef: `sha256/${parts[3].slice(0, 2)}/${parts[3]}`,
    } } };
  }

  async read(blobRef: string, expectedDigest: string): Promise<Uint8Array> {
    const { identity, reference } = this.decode(blobRef, expectedDigest);
    return this.content.read(identity, reference);
  }

  async *readStream(blobRef: string, expectedDigest: string): AsyncIterable<Uint8Array> {
    const { identity, reference } = this.decode(blobRef, expectedDigest);
    yield* this.content.readStream(identity, reference);
  }

  async collectOrphans(): Promise<never> {
    throw new Error('ENCRYPTED_BLOB_GC_REQUIRES_KEY_RECONCILIATION');
  }
}
