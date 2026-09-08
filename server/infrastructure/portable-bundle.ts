import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { portableWorkspaceFacts } from '../application/portable-workspace';
import { validatePortableReferences } from '../application/portable-references';
import type { PortableBundlePort, PortableWorkspaceFacts, BundleExport } from '../application/ports/portable-workspace';
import type { BlobStorePort } from '../application/ports/host-runtime';
import { BUNDLE_MEDIA_TYPE, BUNDLE_LIMITS, bundleError, type BundleDescriptor, type BundleIndex } from '../domain/portable-bundle';
import { canonicalJson } from '../domain/canonical-json';
import { semanticStateChecksum } from './workspace-semantic-checksum';
import { describeBundleFile, writeBundleArchive } from './bundle-archive';
import indexSchema from '../contracts/bundle-index.schema.json';
import { validatePortableContent } from './portable-content';

export class NodePortableBundle implements PortableBundlePort {
  constructor(private readonly blobs: BlobStorePort) {}

  async export(source: PortableWorkspaceFacts): Promise<BundleExport> {
    const facts = portableWorkspaceFacts(source, input => semanticStateChecksum(input as Record<string, unknown>));
    validatePortableReferences(facts);
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-bundle-export-'));
    try {
      const files = new Map<string, string>();
      const entries: BundleDescriptor[] = [];
      let expanded = 0;
      const reserve = (size: number) => {
        expanded += size;
        if (!Number.isSafeInteger(size) || size < 0 || size > BUNDLE_LIMITS.maxSingleEntryBytes || expanded > BUNDLE_LIMITS.maxExpandedBytes
          || entries.length + 2 > BUNDLE_LIMITS.maxEntries) throw bundleError('BUNDLE_QUOTA_EXCEEDED');
      };
      const add = async (name: string, value: unknown, mediaType = 'application/json') => {
        const content = canonicalJson(value); reserve(Buffer.byteLength(content));
        const path = join(directory, name); await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content, { flag: 'wx', mode: 0o600 });
        files.set(name, path); entries.push(await describeBundleFile(path, name, mediaType));
      };
      await add('rhiza-layout.json', { formatVersion: '1.0.0', index: 'index.json' });
      await add('schemas/bundle-index-v1.json', indexSchema, 'application/schema+json');
      const runtimeSnapshots = facts.runs.map(run => ({ id: `run:${run.id}:input:${run.originInputHash ?? run.inputHash}`, runRef: run.id, digest: `sha256:${run.inputHash}` }));
      const providerEndpoints = facts.runs.map(run => ({ id: run.input.executor.providerEndpointRef, runRef: run.id, providerType: run.input.executor.provider,
        configurationVersion: run.input.request.modelSnapshot?.endpointVersion ?? null, credential_ref: null, credential_required: true }));
      const modelSpecs = facts.runs.map(run => ({ id: run.input.executor.modelSpecRef, runRef: run.id, model: run.input.executor.model, provider: run.input.executor.provider }));
      await add('workspace.json', { schemaVersion: '1.0.0', facts, runtimeSnapshots, providerEndpoints, modelSpecs });
      for (const run of facts.runs) {
        const name = `blobs/sha256/${run.inputHash}`;
        if (!files.has(name)) await add(name, run.input, 'application/vnd.rhiza.context-envelope.v1+json');
      }
      for (const version of facts.workspace.resourceVersions) {
        const name = `blobs/sha256/${version.digest}`;
        if (files.has(name)) continue;
        reserve(version.size);
        const path = join(directory, name); await mkdir(dirname(path), { recursive: true });
        const bytes = this.blobs.readStream ? this.blobs.readStream(version.blobRef, version.digest) : [await this.blobs.read(version.blobRef, version.digest)];
        let written = 0;
        await pipeline(Readable.from(bytes), new Transform({ transform(chunk: Buffer, _encoding, callback) {
          written += chunk.length;
          callback(written > version.size ? bundleError('BUNDLE_SIZE_MISMATCH') : null, chunk);
        } }), createWriteStream(path, { flags: 'wx', mode: 0o600 }));
        const descriptor = await describeBundleFile(path, name, version.mediaType);
        if (descriptor.digest !== `sha256:${version.digest}` || descriptor.size !== version.size) throw bundleError('BUNDLE_DIGEST_MISMATCH');
        files.set(name, path); entries.push(descriptor);
      }
      const destination = join(directory, 'workspace.rhiza');
      const index: BundleIndex = { mediaType: BUNDLE_MEDIA_TYPE, formatVersion: '1.0.0', workspaceId: facts.workspace.projectId, root: 'workspace.json', entries };
      validatePortableContent(facts, index);
      await writeBundleArchive(index, files, destination);
      const size = (await stat(destination)).size;
      if (size > BUNDLE_LIMITS.maxArchiveBytes) throw bundleError('BUNDLE_QUOTA_EXCEEDED');
      return { size, bytes: createReadStream(destination), dispose: () => rm(directory, { recursive: true, force: true }) };
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  }
}
