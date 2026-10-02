// @vitest-environment node
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { expect, it } from 'vitest';
import { BUNDLE_LIMITS } from '../domain/portable-bundle';
import { stageHydrationUpload } from './bundle-hydration-upload';

const boundary = 'rhiza-fixture-boundary';
const contentType = `multipart/form-data; boundary=${boundary}`;
type Part = { name: string; value: string; filename?: string };
function body(parts: Part[], complete = true) {
  return Buffer.from(parts.map(part => `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"${part.filename === undefined ? '' : `; filename="${part.filename}"`}\r\nContent-Type: ${part.filename === undefined ? 'text/plain' : 'application/octet-stream'}\r\n\r\n${part.value}\r\n`).join('') + (complete ? `--${boundary}--\r\n` : ''));
}
async function collect(bytes: AsyncIterable<Uint8Array>) { const chunks: Uint8Array[] = []; for await (const chunk of bytes) chunks.push(chunk); return Buffer.concat(chunks).toString(); }

it('streams unordered multipart files into private generated paths and disposes all uploads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-hydration-upload-'));
  try {
    const uploaded = await stageHydrationUpload(Readable.from([body([
      { name: 'resource:version/../one', value: 'Frozen bytes', filename: '../../private.txt' },
      { name: 'bundle', value: 'Archive bytes', filename: '/private/source.rhiza' },
    ])]), contentType, root);
    const [directory] = await readdir(root);
    expect(((await stat(join(root, directory))).mode & 0o077)).toBe(0);
    expect(await readdir(join(root, directory))).toEqual(['part-1', 'part-2']);
    expect(await collect(uploaded.bundle)).toBe('Archive bytes');
    const resources = [];
    for await (const resource of uploaded.resources) resources.push({ id: resource.resourceVersionId, text: await collect(resource.bytes) });
    expect(resources).toEqual([{ id: 'version/../one', text: 'Frozen bytes' }]);
    await uploaded.dispose(); expect(await readdir(root)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('reports unavailable staging storage without exposing a filesystem path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-hydration-storage-'));
  try {
    const invalidRoot = join(root, 'file'); await writeFile(invalidRoot, 'fixture');
    await expect(stageHydrationUpload(Readable.from([]), contentType, join(invalidRoot, 'nested')))
      .rejects.toMatchObject({ code: 'BUNDLE_UPLOAD_STORAGE_UNAVAILABLE', status: 503, message: 'BUNDLE_UPLOAD_STORAGE_UNAVAILABLE' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('rejects malformed, duplicate and forbidden parts and quota failures after settling writers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-hydration-upload-reject-'));
  const bundle = { name: 'bundle', value: 'zip', filename: 'source.rhiza' };
  try {
    for (const parts of [[bundle, bundle], [bundle, { name: 'unknown', value: 'bytes', filename: 'file' }],
      [bundle, { name: 'ownerId', value: 'other-owner' }], [{ name: 'resource:version', value: 'bytes', filename: 'file' }],
      [bundle, { name: 'resource:version', value: 'a', filename: 'file' }, { name: 'resource:version', value: 'b', filename: 'file' }]]) {
      await expect(stageHydrationUpload(Readable.from([body(parts)]), contentType, root)).rejects.toMatchObject({ code: 'BUNDLE_INVALID_MULTIPART' });
      expect(await readdir(root)).toEqual([]);
    }
    await expect(stageHydrationUpload(Readable.from([body([bundle], false)]), contentType, root)).rejects.toMatchObject({ code: 'BUNDLE_INVALID_MULTIPART' });
    await expect(stageHydrationUpload(Readable.from([body([bundle])]), 'multipart/form-data', root)).rejects.toMatchObject({ code: 'BUNDLE_INVALID_MULTIPART' });
    await expect(stageHydrationUpload((async function* () {
      yield body([bundle], false); throw new Error('fixture client disconnect');
    })(), contentType, root)).rejects.toMatchObject({ code: 'BUNDLE_INVALID_MULTIPART' });
    await expect(stageHydrationUpload(Readable.from([body([bundle, { name: 'resource:version', value: 'x'.repeat(64), filename: 'file' }])]), contentType, root,
      { ...BUNDLE_LIMITS, maxSingleEntryBytes: 16 })).rejects.toMatchObject({ code: 'BUNDLE_QUOTA_EXCEEDED' });
    expect(await readdir(root)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
