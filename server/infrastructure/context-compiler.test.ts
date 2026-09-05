// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { BlobContextCompiler } from '../application/context-compiler';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import type { ContextItem } from '../domain';

it('freezes exact Unicode and empty text in verified content-addressed blobs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rhiza-context-compiler-'));
  try {
    const blobs = new NodeFilesystemBlobStore(directory);
    const compiler = new BlobContextCompiler(blobs, randomUUID, () => '2026-09-06T00:00:00.000Z');
    const items: ContextItem[] = ['退款\n🧪 é', ''].map((content, index) => ({ id: String(index), title: 'source', detail: 'detail', role: 'Reference', status: 'active', tokens: 1, content }));
    const frozen = await compiler.compile('workspace', items);
    for (const [index, selected] of frozen.entries()) {
      expect(selected.resource).toMatchObject({ workspaceId: 'workspace', kind: 'context-source' });
      expect(selected.resourceVersion.resourceId).toBe(selected.resource.id);
      expect(selected.priority).toBe(index);
      expect(JSON.parse(new TextDecoder().decode(await blobs.read(selected.resourceVersion.blobRef, selected.resourceVersion.digest))).content).toBe(items[index].content);
    }
    items[0].content = 'edited';
    expect(frozen[0].item.content).toBe('退款\n🧪 é');
    await expect(compiler.compile('workspace', [{ ...items[0], content: undefined }])).rejects.toMatchObject({ code: 'CONTEXT_SOURCE_UNRESOLVED' });
    const corrupt = new BlobContextCompiler({ put: bytes => blobs.put(bytes), read: async () => new Uint8Array([0]), collectOrphans: (...args) => blobs.collectOrphans(...args) }, randomUUID, () => '2026-09-06T00:00:00.000Z');
    await expect(corrupt.compile('workspace', items)).rejects.toMatchObject({ code: 'BLOB_INTEGRITY_ERROR' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
