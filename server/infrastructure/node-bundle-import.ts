import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { BundleImportArchivePort, StagedBundleImport } from '../application/ports/bundle-import';
import type { BlobStorePort } from '../application/ports/host-runtime';
import { BUNDLE_LIMITS, bundleError } from '../domain/portable-bundle';
import { ingestPortableBlobs, NodeImportArchiveStore, stagePortableWorkspace } from './portable-content';

export class NodeBundleImport implements BundleImportArchivePort {
  constructor(private readonly archiveRoot: string, private readonly blobs: BlobStorePort) {}
  async receive(bytes: AsyncIterable<Uint8Array>): Promise<StagedBundleImport> {
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-bundle-upload-'));
    const path = join(directory, 'archive.rhiza');
    try {
      let size = 0;
      await pipeline(Readable.from(bytes), new Transform({ transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        callback(size > BUNDLE_LIMITS.maxArchiveBytes ? bundleError('BUNDLE_QUOTA_EXCEEDED') : null, chunk);
      } }), createWriteStream(path, { flags: 'wx', mode: 0o600 }));
      const staged = await stagePortableWorkspace(path);
      return { facts: staged.facts, archiveDigest: staged.archiveDigest,
        retain: () => new NodeImportArchiveStore(this.archiveRoot).retain(path, staged.archiveDigest),
        ingest: () => ingestPortableBlobs(staged, this.blobs),
        dispose: async () => { try { await staged.dispose(); } finally { await rm(directory, { recursive: true, force: true }); } } };
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  }
}
