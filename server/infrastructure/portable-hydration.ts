import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BUNDLE_LIMITS, bundleError, type BundleExport, type ProvidedBundleResource } from '../domain/portable-bundle';
import { canonicalJson } from '../domain/canonical-json';
import { describeBundleFile, writeBundleArchive } from './bundle-archive';
import { decodePortableDocument, type StagedPortableWorkspace } from './portable-content';

/** No store/key writes. The output owns every byte, so checkpoint recovery never depends on supplied files. */
export async function hydratePortableWorkspace(staged: StagedPortableWorkspace,
  resources: AsyncIterable<ProvidedBundleResource> | Iterable<ProvidedBundleResource>, stagingRoot = tmpdir()): Promise<BundleExport> {
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(stagingRoot, 'rhiza-bundle-export-'));
  try {
    const external = new Map(staged.assessment.externalResources.map(item => [item.resourceVersionId, item]));
    const supplied = new Set<string>(); const files = new Map(staged.files); const entries = [...staged.index.entries];
    let count = 0; let streamed = staged.index.entries.reduce((total, entry) => total + entry.size, 0);
    for await (const resource of resources) {
      const descriptor = external.get(resource?.resourceVersionId);
      if (!descriptor || supplied.has(resource.resourceVersionId)) throw bundleError('BUNDLE_EXTERNAL_DESCRIPTOR_MISMATCH');
      if (++count + staged.index.entries.length + 1 > BUNDLE_LIMITS.maxEntries) throw bundleError('BUNDLE_QUOTA_EXCEEDED');
      supplied.add(resource.resourceVersionId);
      // Caller names and locations never select a filesystem path.
      const path = join(directory, `resource-${count}`); let size = 0;
      await pipeline(Readable.from(resource.bytes), new Transform({ transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        streamed += chunk.length;
        callback(size > descriptor.size ? bundleError('BUNDLE_EXTERNAL_CONTENT_MISMATCH')
          : streamed > BUNDLE_LIMITS.maxExpandedBytes ? bundleError('BUNDLE_QUOTA_EXCEEDED') : null, chunk);
      } }), createWriteStream(path, { flags: 'wx', mode: 0o600 }));
      const name = `blobs/sha256/${descriptor.digest}`;
      const observed = await describeBundleFile(path, name, descriptor.mediaType);
      if (observed.digest !== `sha256:${descriptor.digest}` || observed.size !== descriptor.size) throw bundleError('BUNDLE_EXTERNAL_CONTENT_MISMATCH');
      if (!files.has(name)) { files.set(name, path); entries.push(observed); }
    }
    if (staged.assessment.missingResources.some(item => !files.has(`blobs/sha256/${item.digest}`))) throw bundleError('BUNDLE_EXTERNAL_CONTENT_REQUIRED');
    const document = JSON.parse(await readFile(staged.files.get(staged.index.root)!, 'utf8'));
    if (document.schemaVersion === '3.0.0') document.externalResources = [];
    const content = canonicalJson(document);
    if (Buffer.byteLength(content) > BUNDLE_LIMITS.maxDocumentBytes) throw bundleError('BUNDLE_QUOTA_EXCEEDED');
    const rootPath = join(directory, 'workspace.json'); await writeFile(rootPath, content, { flag: 'wx', mode: 0o600 });
    files.set(staged.index.root, rootPath);
    const rootDescriptor = await describeBundleFile(rootPath, staged.index.root, 'application/json');
    const index = { ...staged.index, entries: entries.map(entry => entry.path === staged.index.root ? rootDescriptor : entry) };
    decodePortableDocument(document, index);
    const destination = join(directory, 'complete.rhiza');
    await writeBundleArchive(index, files, destination);
    const size = (await stat(destination)).size;
    if (size > BUNDLE_LIMITS.maxArchiveBytes) throw bundleError('BUNDLE_QUOTA_EXCEEDED');
    return { bytes: createReadStream(destination), size, dispose: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}
