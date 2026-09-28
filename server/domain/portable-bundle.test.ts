import { describe, expect, it } from 'vitest';
import { BUNDLE_LIMITS, BUNDLE_MEDIA_TYPE, validateBundleIndex, validateBundlePath } from './portable-bundle';

const descriptor = (path: string) => ({ path, mediaType: 'application/json', digest: `sha256:${'a'.repeat(64)}`, size: 10 });
const fixture = () => ({ mediaType: BUNDLE_MEDIA_TYPE, formatVersion: '1.0.0', workspaceId: '00000000-0000-4000-8000-000000000001', root: 'workspace.json', entries: [descriptor('rhiza-layout.json'), descriptor('workspace.json')] });
describe('Bundle trust boundary', () => {
  it.each(['/escape', '../escape', 'a/../b', 'C:/escape', 'a\\b', 'a\0b', 'a//b', './a', 'a/', 'con.txt', 'a/NUL', 'a.'])('rejects unsafe path %j', path => {
    expect(() => validateBundlePath(path)).toThrow('BUNDLE_UNSAFE_PATH');
  });
  it('requires a supported closed descriptor index', () => {
    expect(validateBundleIndex(fixture())).toEqual(fixture());
    expect(() => validateBundleIndex({ ...fixture(), formatVersion: '2.0.0' })).toThrow('BUNDLE_UNSUPPORTED_FORMAT');
    expect(() => validateBundleIndex({ ...fixture(), root: 'missing' })).toThrow('BUNDLE_MISSING_ROOT');
    expect(() => validateBundleIndex({ ...fixture(), entries: [...fixture().entries, descriptor('WORKSPACE.json')] })).toThrow('BUNDLE_DUPLICATE_ENTRY');
    expect(() => validateBundleIndex({ ...fixture(), entries: [...fixture().entries, descriptor('blobs/sha256/wrong')] })).toThrow('BUNDLE_DIGEST_PATH_MISMATCH');
    expect(() => validateBundleIndex({ ...fixture(), entries: [...fixture().entries, { ...descriptor('extra'), size: -1 }] })).toThrow('BUNDLE_INVALID_DESCRIPTOR');
  });
  it('enforces descriptor quotas before extraction', () => {
    expect(() => validateBundleIndex(fixture(), { ...BUNDLE_LIMITS, maxSingleEntryBytes: 9 })).toThrow('BUNDLE_QUOTA_EXCEEDED');
    expect(() => validateBundleIndex(fixture(), { ...BUNDLE_LIMITS, maxExpandedBytes: 19 })).toThrow('BUNDLE_QUOTA_EXCEEDED');
    expect(() => validateBundleIndex(fixture(), { ...BUNDLE_LIMITS, maxEntries: 2 })).toThrow('BUNDLE_INVALID_INDEX');
  });
});
