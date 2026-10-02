import Busboy from '@fastify/busboy';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { StagedHydrationUpload } from '../application/ports/bundle-import';
import { BUNDLE_LIMITS, bundleError, type BundleLimits } from '../domain/portable-bundle';

function uploadError(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code?.startsWith('BUNDLE_')) return error as Error;
  if (['EACCES', 'EPERM', 'ENOSPC', 'EROFS', 'ENOENT', 'ENOTDIR', 'EMFILE', 'ENFILE'].includes(code ?? '')) {
    return Object.assign(new Error('BUNDLE_UPLOAD_STORAGE_UNAVAILABLE'), { code: 'BUNDLE_UPLOAD_STORAGE_UNAVAILABLE', status: 503 });
  }
  return bundleError('BUNDLE_INVALID_MULTIPART');
}

/** File names are presentation only. All filesystem paths are generated under private staging. */
export async function stageHydrationUpload(bytes: AsyncIterable<Uint8Array>, contentType: string, root: string,
  limits: BundleLimits = BUNDLE_LIMITS): Promise<StagedHydrationUpload> {
  let parser: InstanceType<typeof Busboy>;
  try {
    parser = new Busboy({ headers: { 'content-type': contentType }, limits: {
      fieldNameSize: 240, fields: 0, files: limits.maxEntries, parts: limits.maxEntries,
      fileSize: Math.max(limits.maxArchiveBytes, limits.maxSingleEntryBytes), headerPairs: 20, headerSize: 16 * 1024,
    } });
  } catch { throw bundleError('BUNDLE_INVALID_MULTIPART'); }
  let directory: string;
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
    directory = await mkdtemp(join(root, 'rhiza-bundle-upload-'));
  } catch (error) { throw uploadError(error); }
  let failure: Error | undefined;
  let bundlePath: string | undefined;
  const resources: Array<{ resourceVersionId: string; path: string }> = [];
  const names = new Set<string>(); const active = new Set<Readable>(); const tasks: Promise<void>[] = [];
  let writing = Promise.resolve(); let count = 0;
  const stop = (error: unknown) => {
    if (failure) return;
    failure = uploadError(error);
    for (const stream of active) stream.destroy(failure);
    parser.destroy(failure);
  };
  parser.on('file', (name, stream) => {
    active.add(stream); stream.on('close', () => active.delete(stream)); stream.on('error', stop);
    stream.on('limit', () => stop(bundleError('BUNDLE_QUOTA_EXCEEDED')));
    const resourceVersionId = name.startsWith('resource:') ? name.slice(9) : undefined;
    if (failure || names.has(name) || (name !== 'bundle' && (!resourceVersionId || resourceVersionId.length > 200))) {
      stop(bundleError('BUNDLE_INVALID_MULTIPART')); stream.resume(); return;
    }
    names.add(name); const path = join(directory, `part-${++count}`);
    if (name === 'bundle') bundlePath = path;
    else resources.push({ resourceVersionId: resourceVersionId!, path });
    // Serialize disk writers; many small parts must not open one descriptor per file simultaneously.
    const task = writing.then(async () => {
      if (failure) throw failure;
      let size = 0; const maximum = name === 'bundle' ? limits.maxArchiveBytes : limits.maxSingleEntryBytes;
      await pipeline(stream, new Transform({ transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length; callback(size > maximum ? bundleError('BUNDLE_QUOTA_EXCEEDED') : null, chunk);
      } }), createWriteStream(path, { flags: 'wx', mode: 0o600 }));
    });
    task.catch(stop); tasks.push(task); writing = task.catch(() => {});
  });
  parser.on('fieldsLimit', () => stop(bundleError('BUNDLE_INVALID_MULTIPART')));
  parser.on('filesLimit', () => stop(bundleError('BUNDLE_QUOTA_EXCEEDED')));
  parser.on('partsLimit', () => stop(bundleError('BUNDLE_QUOTA_EXCEEDED')));
  try {
    let total = 0;
    await pipeline(Readable.from(bytes), new Transform({ transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      callback(total > limits.maxArchiveBytes + limits.maxExpandedBytes ? bundleError('BUNDLE_QUOTA_EXCEEDED') : null, chunk);
    } }), parser);
    await Promise.allSettled(tasks);
    if (failure) throw failure;
    if (!bundlePath) throw bundleError('BUNDLE_INVALID_MULTIPART');
    return { bundle: createReadStream(bundlePath), resources: (async function* () {
      for (const resource of resources) yield { resourceVersionId: resource.resourceVersionId, bytes: createReadStream(resource.path) };
    })(), dispose: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    stop(error); await Promise.allSettled(tasks); await rm(directory, { recursive: true, force: true }); throw failure!;
  }
}
