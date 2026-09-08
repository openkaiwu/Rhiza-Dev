export const BUNDLE_MEDIA_TYPE = 'application/vnd.rhiza.workspace.manifest.v1+json';
export const BUNDLE_FORMAT_VERSION = '1.0.0';
export const BUNDLE_LIMITS = Object.freeze({
  maxArchiveBytes: 2 * 1024 ** 3, maxExpandedBytes: 10 * 1024 ** 3,
  maxCompressionRatio: 100, maxEntries: 100_000, maxSingleEntryBytes: 2 * 1024 ** 3,
  maxIndexBytes: 16 * 1024 ** 2,
});
export type BundleLimits = { [K in keyof typeof BUNDLE_LIMITS]: number };
export interface BundleDescriptor { path: string; mediaType: string; digest: string; size: number }
export interface BundleIndex {
  mediaType: typeof BUNDLE_MEDIA_TYPE;
  formatVersion: typeof BUNDLE_FORMAT_VERSION;
  workspaceId: string;
  root: string;
  entries: BundleDescriptor[];
}

export interface BundleExport {
  bytes: AsyncIterable<Uint8Array>;
  size: number;
  dispose(): Promise<void>;
}

export function bundleError(code: string): Error & { code: string; status: number } {
  return Object.assign(new Error(code), { code, status: 400 });
}

/** Reject aliases rather than silently normalizing a hostile archive name. */
export function validateBundlePath(path: string): string {
  if (!path || path !== path.normalize('NFC') || /[\\:]/u.test(path) || [...path].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) {
    throw bundleError('BUNDLE_UNSAFE_PATH');
  }
  if (path.split('/').some(part => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw bundleError('BUNDLE_UNSAFE_PATH');
  return path;
}

export function validateBundleIndex(input: unknown, limits: BundleLimits = BUNDLE_LIMITS): BundleIndex {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bundleError('BUNDLE_INVALID_INDEX');
  const index = input as Record<string, unknown>;
  if (index.mediaType !== BUNDLE_MEDIA_TYPE || index.formatVersion !== BUNDLE_FORMAT_VERSION) throw bundleError('BUNDLE_UNSUPPORTED_FORMAT');
  if (typeof index.workspaceId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(index.workspaceId)
    || typeof index.root !== 'string' || !Array.isArray(index.entries) || index.entries.length + 1 > limits.maxEntries) throw bundleError('BUNDLE_INVALID_INDEX');
  if (Object.keys(index).some(key => !['mediaType', 'formatVersion', 'workspaceId', 'root', 'entries'].includes(key))) throw bundleError('BUNDLE_INVALID_INDEX');
  const names = new Set(['index.json']);
  let expanded = 0;
  for (const candidate of index.entries) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw bundleError('BUNDLE_INVALID_DESCRIPTOR');
    const entry = candidate as Record<string, unknown>;
    if (Object.keys(entry).some(key => !['path', 'mediaType', 'digest', 'size'].includes(key))
      || typeof entry.path !== 'string' || typeof entry.mediaType !== 'string' || !entry.mediaType
      || typeof entry.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(entry.digest)
      || typeof entry.size !== 'number' || !Number.isSafeInteger(entry.size) || entry.size < 0) throw bundleError('BUNDLE_INVALID_DESCRIPTOR');
    validateBundlePath(entry.path);
    const normalized = entry.path.toLowerCase();
    if (names.has(normalized)) throw bundleError('BUNDLE_DUPLICATE_ENTRY');
    names.add(normalized);
    expanded += entry.size;
    if (entry.size > limits.maxSingleEntryBytes || expanded > limits.maxExpandedBytes) throw bundleError('BUNDLE_QUOTA_EXCEEDED');
    if (entry.path.startsWith('blobs/sha256/') && entry.path !== `blobs/sha256/${entry.digest.slice(7)}`) throw bundleError('BUNDLE_DIGEST_PATH_MISMATCH');
  }
  if (!names.has('rhiza-layout.json') || !index.entries.some(entry => entry.path === index.root)) throw bundleError('BUNDLE_MISSING_ROOT');
  return input as BundleIndex;
}
