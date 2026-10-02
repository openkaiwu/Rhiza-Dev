import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { BundleImportArchivePort, StagedBundleImport } from '../application/ports/bundle-import';
import type { BlobStorePort } from '../application/ports/host-runtime';
import { BUNDLE_LIMITS, bundleError } from '../domain/portable-bundle';
import { ingestPortableWorkspace, NodeImportArchiveStore, stagePortableWorkspace } from './portable-content';
import { hydratePortableWorkspace } from './portable-hydration';

export class NodeBundleImport implements BundleImportArchivePort {
  constructor(private readonly archiveRoot: string, private readonly blobs: BlobStorePort) {}
  async receive(bytes: AsyncIterable<Uint8Array>): Promise<StagedBundleImport> {
    const transient = join(this.archiveRoot, 'transient');
    await mkdir(transient, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(transient, 'rhiza-bundle-upload-'));
    const path = join(directory, 'archive.rhiza');
    try {
      let size = 0;
      await pipeline(Readable.from(bytes), new Transform({ transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        callback(size > BUNDLE_LIMITS.maxArchiveBytes ? bundleError('BUNDLE_QUOTA_EXCEEDED') : null, chunk);
      } }), createWriteStream(path, { flags: 'wx', mode: 0o600 }));
      const staged = await stagePortableWorkspace(path, BUNDLE_LIMITS, transient, { allowExternal: true });
      return { facts: staged.facts, assessment: staged.assessment, archiveDigest: staged.archiveDigest,
        retain: () => {
          if (staged.assessment.missingResources.length) throw bundleError('BUNDLE_EXTERNAL_CONTENT_REQUIRED');
          return new NodeImportArchiveStore(this.archiveRoot).retain(path, staged.archiveDigest);
        },
        ingest: () => ingestPortableWorkspace(staged, this.blobs),
        hydrate: resources => hydratePortableWorkspace(staged, resources, transient),
        dispose: async () => { try { await staged.dispose(); } finally { await rm(directory, { recursive: true, force: true }); } } };
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  }
}
