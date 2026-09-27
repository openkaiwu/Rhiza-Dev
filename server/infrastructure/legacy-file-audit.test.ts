import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { auditLegacyFileReplicas } from './legacy-file-audit';

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
