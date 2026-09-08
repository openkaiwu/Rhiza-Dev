import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as yauzl from 'yauzl';
import { ZipFile as ZipWriter } from 'yazl';
import { BUNDLE_LIMITS, bundleError, validateBundleIndex, validateBundlePath, type BundleDescriptor, type BundleIndex, type BundleLimits } from '../domain/portable-bundle';

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => yauzl.open(path, { autoClose: false, lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => error ? reject(error) : resolve(zip!)));
}
function streamEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream!)));
}

async function metadata(zip: yauzl.ZipFile, limits: BundleLimits): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: yauzl.Entry[] = [];
    const names = new Set<string>();
    let expanded = 0;
    zip.on('error', reject);
    zip.on('entry', (entry: yauzl.Entry) => {
      try {
        validateBundlePath(entry.fileName);
        const name = entry.fileName.toLowerCase();
        if (names.has(name)) throw bundleError('BUNDLE_DUPLICATE_ENTRY');
        names.add(name);
        const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
        if ((mode !== 0 && mode !== 0x8000) || (entry.externalFileAttributes & 0x10)
          || entry.extraFields.some(field => field.id === 0x000d || field.id === 0x756e)) throw bundleError('BUNDLE_UNSAFE_ENTRY_TYPE');
        if ((entry.generalPurposeBitFlag & 1) || ![0, 8].includes(entry.compressionMethod)) throw bundleError('BUNDLE_UNSUPPORTED_ENTRY');
        expanded += entry.uncompressedSize;
        if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > limits.maxSingleEntryBytes
          || entry.uncompressedSize > Math.max(1, entry.compressedSize) * limits.maxCompressionRatio
          || expanded > limits.maxExpandedBytes || entries.length + 1 > limits.maxEntries) throw bundleError('BUNDLE_QUOTA_EXCEEDED');
        entries.push(entry);
        zip.readEntry();
      } catch (error) { reject(error); }
    });
    zip.once('end', () => resolve(entries));
    zip.readEntry();
  });
}

export interface StagedBundleArchive {
  directory: string;
  index: BundleIndex;
  archiveDigest: string;
  files: ReadonlyMap<string, string>;
  dispose(): Promise<void>;
}

/** All extracted paths are beneath a newly created private staging directory. */
export async function stageBundleArchive(path: string, limits: BundleLimits = BUNDLE_LIMITS): Promise<StagedBundleArchive> {
  const file = await stat(path);
  if (!file.isFile() || file.size > limits.maxArchiveBytes) throw bundleError('BUNDLE_QUOTA_EXCEEDED');
  const archiveHash = createHash('sha256');
  let archiveBytes = 0;
  for await (const chunk of createReadStream(path)) {
    archiveBytes += chunk.length;
    if (archiveBytes > limits.maxArchiveBytes) throw bundleError('BUNDLE_QUOTA_EXCEEDED');
    archiveHash.update(chunk);
  }
  const zip = await openZip(path).catch(() => { throw bundleError('BUNDLE_INVALID_ARCHIVE'); });
  const directory = await mkdtemp(join(tmpdir(), 'rhiza-bundle-stage-'));
  try {
    const entries = await metadata(zip, limits);
    const indexEntry = entries.find(entry => entry.fileName === 'index.json');
    if (!indexEntry || indexEntry.uncompressedSize > limits.maxIndexBytes) throw bundleError('BUNDLE_INVALID_INDEX');
    const indexPath = join(directory, 'index.json');
    let indexBytes = 0;
    await pipeline(await streamEntry(zip, indexEntry), new Transform({ transform(chunk: Buffer, _encoding, callback) {
      indexBytes += chunk.length;
      callback(indexBytes > limits.maxIndexBytes ? bundleError('BUNDLE_QUOTA_EXCEEDED') : null, chunk);
    } }), createWriteStream(indexPath, { flags: 'wx', mode: 0o600 }));
    const index = validateBundleIndex(JSON.parse(await readFile(indexPath, 'utf8')), limits);
    const declared = new Map(index.entries.map(entry => [entry.path, entry]));
    if (declared.get(index.root)!.size > limits.maxDocumentBytes
      || declared.get('rhiza-layout.json')!.size > limits.maxIndexBytes) throw bundleError('BUNDLE_QUOTA_EXCEEDED');
    if (entries.length !== declared.size + 1 || entries.some(entry => entry.fileName !== 'index.json' && !declared.has(entry.fileName))) throw bundleError('BUNDLE_UNDECLARED_ENTRY');
    const files = new Map<string, string>([['index.json', indexPath]]);
    let expanded = indexBytes;
    for (const entry of entries) {
      if (entry.fileName === 'index.json') continue;
      const descriptor = declared.get(entry.fileName)!;
      if (entry.uncompressedSize !== descriptor.size) throw bundleError('BUNDLE_SIZE_MISMATCH');
      const target = join(directory, descriptor.path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const hash = createHash('sha256');
      let bytes = 0;
      await pipeline(await streamEntry(zip, entry), new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length; expanded += chunk.length;
        if (bytes > limits.maxSingleEntryBytes || bytes > descriptor.size || expanded > limits.maxExpandedBytes
          || bytes > Math.max(1, entry.compressedSize) * limits.maxCompressionRatio) return callback(bundleError('BUNDLE_QUOTA_EXCEEDED'));
        hash.update(chunk); callback(null, chunk);
      } }), createWriteStream(target, { flags: 'wx', mode: 0o600 }));
      if (bytes !== descriptor.size || `sha256:${hash.digest('hex')}` !== descriptor.digest) throw bundleError('BUNDLE_DIGEST_MISMATCH');
      files.set(descriptor.path, target);
    }
    const layout = JSON.parse(await readFile(files.get('rhiza-layout.json')!, 'utf8'));
    if (layout?.formatVersion !== '1.0.0' || layout?.index !== 'index.json') throw bundleError('BUNDLE_UNSUPPORTED_FORMAT');
    return { directory, index, archiveDigest: archiveHash.digest('hex'), files, dispose: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && error.code.startsWith('BUNDLE_')) throw error;
    throw bundleError('BUNDLE_INVALID_ARCHIVE');
  } finally { zip.close(); }
}

export async function writeBundleArchive(index: BundleIndex, files: ReadonlyMap<string, string>, destination: string): Promise<void> {
  validateBundleIndex(index);
  const zip = new ZipWriter();
  // Stored entries ensure our own exports meet the import ratio quota even for repetitive content.
  zip.addBuffer(Buffer.from(JSON.stringify(index)), 'index.json', { compress: false, mode: 0o100600 });
  for (const descriptor of index.entries) {
    const source = files.get(descriptor.path);
    if (!source) throw bundleError('BUNDLE_MISSING_ENTRY');
    zip.addFile(source, descriptor.path, { compress: false, mode: 0o100600 });
  }
  const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
  zip.on('error', error => output.destroy(error));
  let archiveBytes = 0;
  const writing = pipeline(zip.outputStream, new Transform({ transform(chunk: Buffer, _encoding, callback) {
    archiveBytes += chunk.length;
    callback(archiveBytes > BUNDLE_LIMITS.maxArchiveBytes ? bundleError('BUNDLE_QUOTA_EXCEEDED') : null, chunk);
  } }), output);
  zip.end();
  await writing;
}

export async function describeBundleFile(path: string, name: string, mediaType: string): Promise<BundleDescriptor> {
  validateBundlePath(name);
  const hash = createHash('sha256'); let size = 0;
  for await (const chunk of createReadStream(path)) { size += chunk.length; hash.update(chunk); }
  return { path: name, mediaType, digest: `sha256:${hash.digest('hex')}`, size };
}
