import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { NodeEncryptedBlobStore } from './node-encrypted-blob-store';

interface LegacyFileReferences {
  resourceDigests: string[];
  attachmentKeys: string[];
  archiveDigests: string[];
}

export interface LegacyResourceFileReference {
  workspaceId: string;
  resourceVersionId: string;
  digest: string;
  size: number;
  blobRef: string;
  purgedAt?: string;
}

export interface LegacyAttachmentFileReference {
  workspaceId: string;
  storageKey: string;
  resourceVersionId: string | null;
  size: number;
}

const resourcePath = (root: string, digest: string) => {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('RESOURCE_DIGEST_INVALID');
  return join(root, 'blobs', 'sha256', digest.slice(0, 2), digest);
};

const attachmentPath = (root: string, key: string) => {
  if (key.startsWith('sealed-v1/') || key.startsWith('sha256/')) return undefined;
  if (!/^[A-Za-z0-9._-]+$/.test(key) || key === '.' || key === '..') throw new Error('ATTACHMENT_STORAGE_KEY_INVALID');
  return join(root, key);
};

async function fileOrAbsent(path: string) {
  try { return await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

/** Offline, read-only inventory of known plaintext file locations. */
export async function auditLegacyFileReplicas(root: string, references: LegacyFileReferences) {
  if (!(await lstat(root)).isDirectory()) throw new Error('UPLOAD_DIRECTORY_INVALID');
  let resourceBlobs = 0;
  for (const digest of new Set(references.resourceDigests)) {
    resourceBlobs += Number(Boolean(await fileOrAbsent(resourcePath(root, digest))));
  }
  let attachments = 0;
  for (const key of new Set(references.attachmentKeys)) {
    const path = attachmentPath(root, key);
    if (path) attachments += Number(Boolean(await fileOrAbsent(path)));
  }
  let archives = 0;
  for (const digest of new Set(references.archiveDigests)) {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('BUNDLE_ARCHIVE_DIGEST_INVALID');
    archives += Number(Boolean(await fileOrAbsent(join(root, 'imports', 'blobs', 'sha256', digest.slice(0, 2), digest))));
  }
  const transient = await readdir(join(root, 'imports', 'transient')).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  return { resourceBlobs, attachments, archives,
    abandonedImportWork: transient.filter(name => /^rhiza-bundle-(upload|stage|recovery|export)-/.test(name)).length };
}

/** Offline only: verify every selected plaintext file and its sealed replacement before unlinking. */
export async function reclaimKnownLegacyResourceFiles(root: string, versions: LegacyResourceFileReference[],
  attachments: LegacyAttachmentFileReference[], blobs: NodeEncryptedBlobStore, limit = 100) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('LEGACY_FILE_RECLAIM_LIMIT_INVALID');
  const directory = resolve(root);
  if (!(await lstat(directory)).isDirectory()) throw new Error('UPLOAD_DIRECTORY_INVALID');
  const byId = new Map(versions.map(version => [version.resourceVersionId, version]));
  if (byId.size !== versions.length) throw new Error('RESOURCE_VERSION_ID_DUPLICATE');
  const sealedVersion = (version: LegacyResourceFileReference) => version.blobRef.startsWith('sealed-v1/') && !version.purgedAt;
  const purgedVersion = (version: LegacyResourceFileReference) => version.blobRef === 'purged-v1' && !!version.purgedAt;
  if (versions.some(version => !sealedVersion(version) && !purgedVersion(version))) throw new Error('LEGACY_FILE_REPLACEMENT_INVALID');
  const candidates: Array<{ path: string; digest: string; size: number; versions: LegacyResourceFileReference[]; kind: 'resourceBlobs' | 'attachments' }> = [];
  const byDigest = new Map<string, LegacyResourceFileReference[]>();
  for (const version of versions) {
    const refs = byDigest.get(version.digest) ?? [];
    refs.push(version);
    byDigest.set(version.digest, refs);
  }
  for (const [digest, refs] of byDigest) {
    const path = resourcePath(directory, digest);
    if (await fileOrAbsent(path)) candidates.push({ path, digest, size: refs[0]!.size, versions: refs, kind: 'resourceBlobs' });
  }
  const byKey = new Map<string, LegacyAttachmentFileReference[]>();
  for (const attachment of attachments) {
    const refs = byKey.get(attachment.storageKey) ?? [];
    refs.push(attachment);
    byKey.set(attachment.storageKey, refs);
  }
  for (const [key, refs] of byKey) {
    const path = attachmentPath(directory, key);
    if (!path || !await fileOrAbsent(path)) continue;
    const sealed = refs.map(ref => {
      const version = ref.resourceVersionId ? byId.get(ref.resourceVersionId) : undefined;
      return version && sealedVersion(version) && version.workspaceId === ref.workspaceId && version.size === ref.size ? version : undefined;
    });
    if (sealed.some(ref => !ref)) throw new Error('LEGACY_ATTACHMENT_VERSION_REQUIRED');
    candidates.push({ path, digest: sealed[0]!.digest, size: sealed[0]!.size,
      versions: sealed as LegacyResourceFileReference[], kind: 'attachments' });
  }
  const selected = candidates.slice(0, limit);
  const validated = new Set<string>();
  const proofs: Array<{ path: string; dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number; kind: 'resourceBlobs' | 'attachments' }> = [];
  for (const item of selected) {
    for (let parent = dirname(item.path); parent !== directory; parent = dirname(parent)) {
      if (!(await lstat(parent)).isDirectory()) throw new Error('LEGACY_FILE_SOURCE_PARENT_INVALID');
    }
    if (item.versions.some(ref => ref.digest !== item.digest || ref.size !== item.size || (!sealedVersion(ref) && !purgedVersion(ref)))) {
      throw new Error('LEGACY_FILE_REPLACEMENT_INVALID');
    }
    const active = item.versions.filter(sealedVersion);
    const keyAudit = await blobs.auditKeys(active);
    if (keyAudit.some(record => record.referenced && record.state !== 'active')) throw new Error('LEGACY_FILE_REPLACEMENT_KEY_UNHEALTHY');
    for (const version of active) {
      if (validated.has(version.resourceVersionId)) continue;
      let size = 0;
      for await (const chunk of blobs.readStream(version.blobRef, version.digest)) size += chunk.byteLength;
      if (size !== version.size) throw new Error('LEGACY_FILE_REPLACEMENT_INVALID');
      validated.add(version.resourceVersionId);
    }
    const handle = await open(item.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size !== item.size) throw new Error('LEGACY_FILE_SOURCE_INVALID');
      const hash = createHash('sha256');
      for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
      if (hash.digest('hex') !== item.digest) throw new Error('LEGACY_FILE_SOURCE_INVALID');
      proofs.push({ path: item.path, dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, kind: item.kind });
    } finally { await handle.close(); }
  }
  const removed = { resourceBlobs: 0, attachments: 0 };
  for (const proof of proofs) {
    const current = await lstat(proof.path);
    if (!current.isFile() || current.nlink !== 1 || current.size !== proof.size || current.dev !== proof.dev || current.ino !== proof.ino
      || current.mtimeMs !== proof.mtimeMs || current.ctimeMs !== proof.ctimeMs) throw new Error('LEGACY_FILE_SOURCE_CHANGED');
    await unlink(proof.path);
    removed[proof.kind] += 1;
  }
  return removed;
}
