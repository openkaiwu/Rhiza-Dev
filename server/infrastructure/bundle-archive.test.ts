// @vitest-environment node
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';
import { afterEach, describe, expect, it } from 'vitest';
import { BUNDLE_LIMITS, BUNDLE_MEDIA_TYPE, type BundleIndex } from '../domain/portable-bundle';
import { stageBundleArchive } from './bundle-archive';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function archive(options: { extra?: boolean; duplicate?: boolean; mode?: number; compress?: boolean; root?: string; body?: string; index?: (index: BundleIndex) => void } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'rhiza-archive-test-')); directories.push(directory);
  const root = options.root ?? 'workspace.json';
  const files = new Map([['rhiza-layout.json', JSON.stringify({ formatVersion: '1.0.0', index: 'index.json' })], [root, options.body ?? '{}']]);
  const index: BundleIndex = { mediaType: BUNDLE_MEDIA_TYPE, formatVersion: '1.0.0', workspaceId: '00000000-0000-4000-8000-000000000001', root,
    entries: [...files].map(([path, body]) => ({ path, mediaType: 'application/json', digest: `sha256:${createHash('sha256').update(body).digest('hex')}`, size: Buffer.byteLength(body) })) };
  options.index?.(index);
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify(index)), 'index.json', { compress: false });
  for (const [name, body] of files) zip.addBuffer(Buffer.from(body), name, { compress: options.compress ?? false, mode: name === root ? options.mode ?? 0o100600 : 0o100600 });
  if (options.extra) zip.addBuffer(Buffer.from('extra'), 'extra.json');
  if (options.duplicate) zip.addBuffer(Buffer.from('{}'), root);
  const path = join(directory, 'workspace.rhiza');
  const done = pipeline(zip.outputStream, createWriteStream(path)); zip.end(); await done;
  return path;
}

describe('streamed Bundle archive validation', () => {
  it('verifies every entry before returning private staged files', async () => {
    const path = await archive();
    const staged = await stageBundleArchive(path);
    try {
      expect(await readFile(staged.files.get(staged.index.root)!, 'utf8')).toBe('{}');
      expect(staged.archiveDigest).toBe(createHash('sha256').update(await readFile(path)).digest('hex'));
      expect(staged.files.size).toBe(3);
    } finally { await staged.dispose(); }
    await expect(readFile(join(staged.directory, 'index.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects undeclared entries, duplicate names and symlinks', async () => {
    await expect(stageBundleArchive(await archive({ extra: true }))).rejects.toThrow('BUNDLE_UNDECLARED_ENTRY');
    await expect(stageBundleArchive(await archive({ duplicate: true }))).rejects.toThrow('BUNDLE_DUPLICATE_ENTRY');
    await expect(stageBundleArchive(await archive({ mode: 0o120777 }))).rejects.toThrow('BUNDLE_UNSAFE_ENTRY_TYPE');
  });
  it('rejects descriptor digest and size mismatch', async () => {
    await expect(stageBundleArchive(await archive({ index: index => { index.entries[1].digest = `sha256:${'0'.repeat(64)}`; } }))).rejects.toThrow('BUNDLE_DIGEST_MISMATCH');
    await expect(stageBundleArchive(await archive({ index: index => { index.entries[1].size++; } }))).rejects.toThrow('BUNDLE_SIZE_MISMATCH');
  });
  it('rejects archive, index, expanded-byte and compression-ratio quota violations', async () => {
    const path = await archive();
    await expect(stageBundleArchive(path, { ...BUNDLE_LIMITS, maxArchiveBytes: 10 })).rejects.toThrow('BUNDLE_QUOTA_EXCEEDED');
    await expect(stageBundleArchive(path, { ...BUNDLE_LIMITS, maxIndexBytes: 10 })).rejects.toThrow('BUNDLE_INVALID_INDEX');
    await expect(stageBundleArchive(path, { ...BUNDLE_LIMITS, maxExpandedBytes: 10 })).rejects.toThrow('BUNDLE_QUOTA_EXCEEDED');
    await expect(stageBundleArchive(await archive({ body: 'x'.repeat(100_000), compress: true }))).rejects.toThrow('BUNDLE_QUOTA_EXCEEDED');
  });
  it('rejects traversal in ZIP metadata before creating any payload file', async () => {
    const path = await archive({ root: 'safe.json' });
    const bytes = await readFile(path);
    const before = Buffer.from('safe.json'), after = Buffer.from('../a.json');
    for (let offset = bytes.indexOf(before); offset !== -1; offset = bytes.indexOf(before, offset + before.length)) after.copy(bytes, offset);
    await writeFile(path, bytes);
    await expect(stageBundleArchive(path)).rejects.toThrow();
  });
  it.each([0o040700, 0o020600, 0o060600, 0o010600, 0o140600])('rejects non-regular Unix entry mode %i', async mode => {
    await expect(stageBundleArchive(await archive({ mode }))).rejects.toThrow('BUNDLE_UNSAFE_ENTRY_TYPE');
  });
  it('rejects Unix link extra fields and malformed ZIPs with stable errors', async () => {
    const path = await archive();
    const bytes = await readFile(path);
    const timestamp = Buffer.from([0x55, 0x54, 0x05, 0x00]);
    const offset = bytes.indexOf(timestamp);
    expect(offset).toBeGreaterThan(-1);
    bytes.writeUInt16LE(0x756e, offset);
    await writeFile(path, bytes);
    await expect(stageBundleArchive(path)).rejects.toThrow('BUNDLE_UNSAFE_ENTRY_TYPE');
    await writeFile(path, 'not a zip');
    await expect(stageBundleArchive(path)).rejects.toThrow('BUNDLE_INVALID_ARCHIVE');
  });
  it('enforces actual decompressed bytes even when ZIP and index both lie about size', async () => {
    const path = await archive({ body: 'x'.repeat(100_000), compress: true, index: index => { index.entries[1].size = 2; } });
    const bytes = await readFile(path);
    let changed = false;
    for (let offset = 0; offset + 46 < bytes.length; offset++) {
      if (bytes.readUInt32LE(offset) !== 0x02014b50) continue;
      const length = bytes.readUInt16LE(offset + 28);
      if (bytes.subarray(offset + 46, offset + 46 + length).toString() === 'workspace.json') { bytes.writeUInt32LE(2, offset + 24); changed = true; }
    }
    expect(changed).toBe(true);
    await writeFile(path, bytes);
    await expect(stageBundleArchive(path)).rejects.toThrow(/BUNDLE_(INVALID_ARCHIVE|QUOTA_EXCEEDED)/);
  });
});
