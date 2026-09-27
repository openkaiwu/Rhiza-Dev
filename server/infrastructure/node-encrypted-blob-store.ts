import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { BlobContentIdentity, BlobPutResult, BlobStorePort } from '../application/ports/host-runtime';
import { NodeContentKeys } from './node-content-keys';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { NodeSealedContentStore, type SealedContentRef } from './node-sealed-content-store';

/** Explicit encrypted composition; legacy references must be migrated before selecting this adapter. */
export class NodeEncryptedBlobStore implements BlobStorePort {
  constructor(private readonly content: NodeSealedContentStore, private readonly legacy?: BlobStorePort) {}

  static atDirectory(root: string): NodeEncryptedBlobStore {
    const legacy = new NodeFilesystemBlobStore(root);
    return new NodeEncryptedBlobStore(new NodeSealedContentStore(legacy, new NodeContentKeys(join(root, 'resource-keys'))), legacy);
  }

  async put(bytes: Uint8Array, identity?: BlobContentIdentity): Promise<BlobPutResult> {
    const snapshot = Buffer.from(bytes);
    try {
      return await this.putStream((async function* () { yield snapshot; })(), createHash('sha256').update(snapshot).digest('hex'), snapshot.length, identity);
    } finally { snapshot.fill(0); }
  }

  async putStream(bytes: AsyncIterable<Uint8Array>, expectedDigest: string, expectedSize: number, identity?: BlobContentIdentity): Promise<BlobPutResult> {
    if (!identity?.workspaceId || !identity.contentId) throw new Error('CONTENT_IDENTITY_REQUIRED');
    if (!/^[a-f0-9]{64}$/.test(expectedDigest)) throw new Error('CONTENT_DIGEST_INVALID');
    const prefix = `sealed-v1/${encodeURIComponent(identity.workspaceId)}/${encodeURIComponent(identity.contentId)}`;
    if (prefix.length > 1024) throw new Error('CONTENT_IDENTITY_INVALID');
    async function* verified() {
      const hash = createHash('sha256');
      for await (const chunk of bytes) {
        const snapshot = Buffer.from(chunk);
        try { hash.update(snapshot); yield snapshot; }
        finally { snapshot.fill(0); }
      }
      if (hash.digest('hex') !== expectedDigest) throw new Error('CONTENT_DIGEST_MISMATCH');
    }
    const reference = await this.content.putStream(identity, verified(), expectedSize, expectedDigest);
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

  private keyIdentities(references: ReadonlyArray<{ workspaceId: string; resourceVersionId: string; digest: string; size: number; blobRef: string }>) {
    return references.flatMap(item => {
      if (!/^[a-f0-9]{64}$/.test(item.digest) || !Number.isSafeInteger(item.size) || item.size < 0) throw new Error('RESOURCE_BLOB_REFERENCE_INVALID');
      if (item.blobRef.startsWith('sha256/')) {
        if (item.blobRef !== `sha256/${item.digest.slice(0, 2)}/${item.digest}`) throw new Error('RESOURCE_BLOB_REFERENCE_INVALID');
        return [];
      }
      const { identity, reference } = this.decode(item.blobRef, item.digest);
      if (identity.workspaceId !== item.workspaceId || identity.contentId !== item.resourceVersionId || reference.size !== item.size) {
        throw new Error('RESOURCE_BLOB_IDENTITY_MISMATCH');
      }
      return [identity];
    });
  }

  auditKeys(references: ReadonlyArray<{ workspaceId: string; resourceVersionId: string; digest: string; size: number; blobRef: string }>) {
    return this.content.auditKeys(this.keyIdentities(references));
  }

  /** Offline only: the caller must hold the complete database reference snapshot and exclude publishers. */
  revokeUnreferencedKeys(references: ReadonlyArray<{ workspaceId: string; resourceVersionId: string; digest: string; size: number; blobRef: string }>) {
    return this.content.revokeUnreferencedKeys(this.keyIdentities(references));
  }

  async revokeResourceVersion(reference: { workspaceId: string; resourceVersionId: string; digest: string; size: number; blobRef: string }): Promise<void> {
    const [identity] = this.keyIdentities([reference]);
    if (!identity) throw new Error('RESOURCE_BLOB_REQUIRES_SEALED_REFERENCE');
    await this.content.destroy(identity);
  }

  async read(blobRef: string, expectedDigest: string): Promise<Uint8Array> {
    if (blobRef.startsWith('sha256/')) {
      if (!this.legacy) throw new Error('LEGACY_BLOB_REFERENCE_UNAVAILABLE');
      return this.legacy.read(blobRef, expectedDigest);
    }
    const { identity, reference } = this.decode(blobRef, expectedDigest);
    return this.content.read(identity, reference);
  }

  async *readStream(blobRef: string, expectedDigest: string): AsyncIterable<Uint8Array> {
    if (blobRef.startsWith('sha256/')) {
      if (!this.legacy) throw new Error('LEGACY_BLOB_REFERENCE_UNAVAILABLE');
      if (this.legacy.readStream) yield* this.legacy.readStream(blobRef, expectedDigest);
      else yield await this.legacy.read(blobRef, expectedDigest);
      return;
    }
    const { identity, reference } = this.decode(blobRef, expectedDigest);
    yield* this.content.readStream(identity, reference);
  }

  async collectOrphans(): Promise<never> {
    throw new Error('ENCRYPTED_BLOB_GC_REQUIRES_KEY_RECONCILIATION');
  }
}
