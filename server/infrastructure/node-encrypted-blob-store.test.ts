import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { BlobContextCompiler } from '../application/context-compiler';
import { NodeContentKeys } from './node-content-keys';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { NodeSealedContentStore } from './node-sealed-content-store';
import { NodeEncryptedBlobStore } from './node-encrypted-blob-store';

it('freezes context through encrypted blobs and independently revokes each version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-encrypted-blob-'));
  const content = new NodeSealedContentStore(new NodeFilesystemBlobStore(root), new NodeContentKeys(join(root, 'keys')));
  const blobs = new NodeEncryptedBlobStore(content);
  const compiler = new BlobContextCompiler(blobs, randomUUID, () => '2026-09-09T00:00:00.000Z');
  try {
    const item = { id: 'source', title: 'Source', detail: '', role: 'Reference' as const, status: 'active' as const, tokens: 1, content: 'private context' };
    const [first] = await compiler.compile('workspace-a', [item]);
    const [second] = await compiler.compile('workspace-b', [item]);
    expect(first.resourceVersion.digest).toBe(second.resourceVersion.digest);
    expect(first.resourceVersion.blobRef).not.toBe(second.resourceVersion.blobRef);
    const version = first.resourceVersion;
    expect(() => blobs.auditKeys([{ workspaceId: 'workspace-b', resourceVersionId: version.id, digest: version.digest,
      size: version.size, blobRef: version.blobRef }])).toThrow('RESOURCE_BLOB_IDENTITY_MISMATCH');
    expect(() => blobs.auditKeys([{ workspaceId: 'workspace-a', resourceVersionId: version.id, digest: version.digest,
      size: version.size + 1, blobRef: version.blobRef }])).toThrow('RESOURCE_BLOB_IDENTITY_MISMATCH');
    expect(JSON.parse(new TextDecoder().decode(await blobs.read(version.blobRef, version.digest))).content).toBe(item.content);
    await expect(blobs.read(version.blobRef, '0'.repeat(64))).rejects.toThrow('CONTENT_REFERENCE_INVALID');
    await expect(blobs.put(new Uint8Array([1]))).rejects.toThrow('CONTENT_IDENTITY_REQUIRED');
    await expect(blobs.collectOrphans()).rejects.toThrow('ENCRYPTED_BLOB_GC_REQUIRES_KEY_RECONCILIATION');
    const sourceBytes = await blobs.read(version.blobRef, version.digest);
    const importedIdentity = { workspaceId: 'workspace-import', contentId: 'import-version' };
    const imported = await blobs.putStream((async function* () { yield sourceBytes; })(), version.digest, sourceBytes.length, importedIdentity);
    expect(await blobs.read(imported.blobRef, imported.digest)).toEqual(sourceBytes);
    const resumed = await blobs.putStream((async function* () { yield sourceBytes; })(), version.digest, sourceBytes.length, importedIdentity);
    expect(await blobs.read(resumed.blobRef, resumed.digest)).toEqual(sourceBytes);
    await expect(blobs.put(new TextEncoder().encode('different'), importedIdentity)).rejects.toThrow('CONTENT_IDENTITY_CONFLICT');
    expect(await blobs.read(imported.blobRef, imported.digest)).toEqual(sourceBytes);
    const failedIdentity = { ...importedIdentity, contentId: 'bad-digest' };
    await expect(blobs.putStream((async function* () { yield sourceBytes; })(), '0'.repeat(64), sourceBytes.length, failedIdentity)).rejects.toThrow('CONTENT_DIGEST_MISMATCH');
    await expect(new NodeContentKeys(join(root, 'keys')).read(failedIdentity)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    const recovered = await blobs.putStream((async function* () { yield sourceBytes; })(), version.digest, sourceBytes.length, failedIdentity);
    expect(await blobs.read(recovered.blobRef, recovered.digest)).toEqual(sourceBytes);
    const scopedVersion = { workspaceId: 'workspace-a', resourceVersionId: version.id,
      digest: version.digest, size: version.size, blobRef: version.blobRef };
    await expect(blobs.revokeResourceVersion({ ...scopedVersion, workspaceId: 'workspace-b' }))
      .rejects.toThrow('RESOURCE_BLOB_IDENTITY_MISMATCH');
    await expect(blobs.revokeResourceVersion({ ...scopedVersion, blobRef: `sha256/${version.digest.slice(0, 2)}/${version.digest}` }))
      .rejects.toThrow('RESOURCE_BLOB_REQUIRES_SEALED_REFERENCE');
    await blobs.revokeResourceVersion(scopedVersion);
    await blobs.revokeResourceVersion(scopedVersion);
    await expect(blobs.read(version.blobRef, version.digest)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await expect(blobs.put(sourceBytes, { workspaceId: 'workspace-a', contentId: version.id }))
      .rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    const restored = new NodeEncryptedBlobStore(content);
    expect(JSON.parse(new TextDecoder().decode(await restored.read(second.resourceVersion.blobRef, second.resourceVersion.digest))).content).toBe(item.content);
  } finally { await rm(root, { recursive: true, force: true }); }
});
