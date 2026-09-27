import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

interface LegacyFileReferences {
  resourceDigests: string[];
  attachmentKeys: string[];
  archiveDigests: string[];
}

/** Offline, read-only inventory of known plaintext file locations. */
export async function auditLegacyFileReplicas(root: string, references: LegacyFileReferences) {
  if (!(await lstat(root)).isDirectory()) throw new Error('UPLOAD_DIRECTORY_INVALID');
  const exists = async (path: string) => {
    try { await lstat(path); return 1; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
  };
  let resourceBlobs = 0;
  for (const digest of new Set(references.resourceDigests)) {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('RESOURCE_DIGEST_INVALID');
    resourceBlobs += await exists(join(root, 'blobs', 'sha256', digest.slice(0, 2), digest));
  }
  let attachments = 0;
  for (const key of new Set(references.attachmentKeys)) {
    if (key.startsWith('sealed-v1/') || key.startsWith('sha256/')) continue;
    if (!/^[A-Za-z0-9._-]+$/.test(key) || key === '.' || key === '..') throw new Error('ATTACHMENT_STORAGE_KEY_INVALID');
    attachments += await exists(join(root, key));
  }
  let archives = 0;
  for (const digest of new Set(references.archiveDigests)) {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('BUNDLE_ARCHIVE_DIGEST_INVALID');
    archives += await exists(join(root, 'imports', 'blobs', 'sha256', digest.slice(0, 2), digest));
  }
  const transient = await readdir(join(root, 'imports', 'transient')).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  return { resourceBlobs, attachments, archives,
    abandonedImportWork: transient.filter(name => /^rhiza-bundle-(upload|stage|recovery|export)-/.test(name)).length };
}
