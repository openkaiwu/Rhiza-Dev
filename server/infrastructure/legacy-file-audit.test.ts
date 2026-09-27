import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { auditLegacyFileReplicas, reclaimKnownLegacyResourceFiles } from './legacy-file-audit';
import { NodeContentKeys } from './node-content-keys';
import { NodeEncryptedBlobStore } from './node-encrypted-blob-store';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { NodeSealedContentStore } from './node-sealed-content-store';

it('counts known raw file replicas without reading or deleting them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-file-audit-'));
  const digest = 'a'.repeat(64);
  const archive = 'b'.repeat(64);
  try {
    const refs = { resourceDigests: [digest, digest], attachmentKeys: ['old-attachment', 'sealed-v1/target/ref'], archiveDigests: [archive] };
    expect(await auditLegacyFileReplicas(root, refs)).toEqual({ resourceBlobs: 0, attachments: 0, archives: 0, abandonedImportWork: 0 });
    await mkdir(join(root, 'blobs', 'sha256', 'aa'), { recursive: true });
    await writeFile(join(root, 'blobs', 'sha256', 'aa', digest), 'old resource');
    await writeFile(join(root, 'old-attachment'), 'old attachment');
    await mkdir(join(root, 'imports', 'blobs', 'sha256', 'bb'), { recursive: true });
    await writeFile(join(root, 'imports', 'blobs', 'sha256', 'bb', archive), 'old archive');
    await mkdir(join(root, 'imports', 'transient', 'rhiza-bundle-upload-abandoned'), { recursive: true });
    expect(await auditLegacyFileReplicas(root, refs)).toEqual({ resourceBlobs: 1, attachments: 1, archives: 1, abandonedImportWork: 1 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('reclaims only verified old plaintext copies and can resume after one batch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-file-reclaim-'));
  try {
    const bytes = Buffer.from('legacy bytes with a sealed replacement');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const raw = new NodeFilesystemBlobStore(root);
    const old = await raw.put(bytes);
    const blobs = new NodeEncryptedBlobStore(new NodeSealedContentStore(raw, new NodeContentKeys(join(root, 'resource-keys'))), raw);
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const resourceVersionId = '00000000-0000-4000-8000-000000000002';
    const sealed = await blobs.put(bytes, { workspaceId, contentId: resourceVersionId });
    const versions = [{ workspaceId, resourceVersionId, digest, size: bytes.length, blobRef: sealed.blobRef }];
    const attachments = [{ workspaceId, storageKey: 'old-attachment', resourceVersionId, size: bytes.length }];
    const rawPath = join(root, 'blobs', ...old.blobRef.split('/'));
    await writeFile(join(root, 'old-attachment'), bytes);
    await writeFile(rawPath, 'corrupt');
    await expect(reclaimKnownLegacyResourceFiles(root, versions, attachments, blobs)).rejects.toThrow('LEGACY_FILE_SOURCE_INVALID');
    expect(await auditLegacyFileReplicas(root, { resourceDigests: [digest], attachmentKeys: ['old-attachment'], archiveDigests: [] }))
      .toMatchObject({ resourceBlobs: 1, attachments: 1 });
    await writeFile(rawPath, bytes);
    await expect(reclaimKnownLegacyResourceFiles(root, versions,
      [{ ...attachments[0], workspaceId: '00000000-0000-4000-8000-000000000003' }], blobs))
      .rejects.toThrow('LEGACY_ATTACHMENT_VERSION_REQUIRED');
    await expect(reclaimKnownLegacyResourceFiles(root, versions, [{ ...attachments[0], size: bytes.length + 1 }], blobs))
      .rejects.toThrow('LEGACY_ATTACHMENT_VERSION_REQUIRED');
    await expect(reclaimKnownLegacyResourceFiles(root, [...versions, { ...versions[0], resourceVersionId: 'legacy', blobRef: old.blobRef }], attachments, blobs))
      .rejects.toThrow('LEGACY_FILE_REPLACEMENT_INVALID');
    expect(await reclaimKnownLegacyResourceFiles(root, versions, attachments, blobs, 1)).toEqual({ resourceBlobs: 1, attachments: 0 });
    expect(await reclaimKnownLegacyResourceFiles(root, versions, attachments, blobs, 1)).toEqual({ resourceBlobs: 0, attachments: 1 });
    expect(await reclaimKnownLegacyResourceFiles(root, versions, attachments, blobs, 1)).toEqual({ resourceBlobs: 0, attachments: 0 });
    expect(await blobs.read(sealed.blobRef, digest)).toEqual(bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});
