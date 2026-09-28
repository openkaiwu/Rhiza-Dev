// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { NodeContentKeys } from '../server/infrastructure/node-content-keys';
import { NodeEncryptedBlobStore } from '../server/infrastructure/node-encrypted-blob-store';
import { NodeFilesystemBlobStore } from '../server/infrastructure/node-host-runtime';
import { NodeSealedContentStore } from '../server/infrastructure/node-sealed-content-store';
import type { PostgresWorkspaceStore } from '../server/postgres-store';

it('reconciles ResourceVersion keys across every Workspace before offline revocation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-resource-key-reconcile-'));
  const store = await openEmbeddedWorkspaceStore(join(root, 'database'));
  const legacy = new NodeFilesystemBlobStore(join(root, 'uploads'));
  const content = new NodeSealedContentStore(legacy, new NodeContentKeys(join(root, 'uploads', 'resource-keys')));
  const blobs = new NodeEncryptedBlobStore(content, legacy);
  const workspaces = ['00000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111'];
  const bytes = new TextEncoder().encode('shared plaintext, separate scoped keys');
  const digest = createHash('sha256').update(bytes).digest('hex');
  try {
    const versions = [];
    for (const [index, workspaceId] of workspaces.entries()) {
      const scoped = store.forWorkspace(workspaceId) as PostgresWorkspaceStore;
      await scoped.read();
      const versionId = `version-${index}`;
      const stored = await blobs.put(bytes, { workspaceId, contentId: versionId });
      const resourceId = `resource-${index}`;
      const createdAt = new Date().toISOString();
      await scoped.update(current => ({ ...current,
        resources: [...current.resources, { id: resourceId, workspaceId, kind: 'attachment', logicalName: resourceId, createdAt }],
        resourceVersions: [...current.resourceVersions, { id: versionId, resourceId, version: 1, digestAlgorithm: 'sha256', digest,
          canonicalization: 'raw-v1', mediaType: 'text/plain', size: stored.size, blobRef: stored.blobRef, createdAt }],
      }));
      versions.push(stored);
    }
    const orphan = await blobs.put(bytes, { workspaceId: workspaces[0], contentId: 'uncommitted-version' });
    const audit = await store.auditResourceBlobKeys(blobs);
    expect(audit.filter(item => item.referenced && item.state === 'active')).toHaveLength(2);
    expect(audit.filter(item => !item.referenced && item.state === 'active')).toHaveLength(1);
    expect(await store.auditResourceBlobIntegrity(blobs)).toBe(2);
    expect(await store.reclaimResourceBlobKeys(blobs)).toBe(1);
    await expect(blobs.read(orphan.blobRef, orphan.digest)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    for (const version of versions) expect(Array.from(await blobs.read(version.blobRef, version.digest))).toEqual(Array.from(bytes));
    expect(await store.reclaimResourceBlobKeys(blobs)).toBe(0);
    const ciphertextDigest = versions[1].blobRef.split('/')[3]!;
    await rm(join(root, 'uploads', 'blobs', 'sha256', ciphertextDigest.slice(0, 2), ciphertextDigest));
    await expect(store.auditResourceBlobIntegrity(blobs)).rejects.toThrow('Referenced blob is missing');
    await content.destroy({ workspaceId: workspaces[0], contentId: 'version-0' });
    const nextOrphan = await blobs.put(bytes, { workspaceId: workspaces[1], contentId: 'another-uncommitted-version' });
    await expect(store.reclaimResourceBlobKeys(blobs)).rejects.toThrow('RESOURCE_BLOB_KEYS_UNHEALTHY');
    expect(Array.from(await blobs.read(nextOrphan.blobRef, nextOrphan.digest))).toEqual(Array.from(bytes));
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
}, 30_000);
