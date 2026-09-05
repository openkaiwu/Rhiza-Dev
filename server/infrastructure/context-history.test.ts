// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { BlobContextCompiler } from '../application/context-compiler';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { resolveContextHistory } from '../application/context-history';
import type { ContextHistoryFacts } from '../application/ports/workspace-unit-of-work';

it('resolves frozen evidence and classifies each unavailable historical source', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rhiza-context-history-'));
  try {
    const blobs = new NodeFilesystemBlobStore(directory);
    const [frozen] = await new BlobContextCompiler(blobs, randomUUID, () => '2026-09-06T00:00:00.000Z').compile('workspace', [{ id: 'source', sourceId: 'source', title: 'source', detail: 'detail', role: 'Reference', status: 'active', tokens: 1, content: 'Frozen text' }]);
    const facts: ContextHistoryFacts = { resources: [frozen.resource], versions: [frozen.resourceVersion], manifest: {
      id: 'manifest', projectId: 'workspace', nodeId: 'node', requestId: 'request', createdAt: frozen.resource.createdAt, mode: 'Strict', model: 'test', provider: 'test', runtime: 'provider-adapter',
      contextItemIds: ['source'], excludedItemIds: [], contextItems: [{ sourceType: 'reference', sourceId: 'source', title: 'source', detail: 'detail', role: 'Reference', selectionMode: 'USER_SELECTED', pinned: false, reason: 'Selected', tokenCount: 1, contentVersion: 1, resourceId: frozen.resource.id, resourceVersionId: frozen.resourceVersion.id, digest: frozen.resourceVersion.digest }],
      estimatedTokens: 1, generation: { temperature: 0.4, topP: 1, maxTokens: 50 }, operation: 'send', attachmentIds: [],
    } };
    const status = async (input: ContextHistoryFacts) => (await resolveContextHistory(input, blobs)).sources[0].status;
    expect((await resolveContextHistory(facts, blobs)).sources[0]).toMatchObject({ status: 'resolved', content: 'Frozen text' });
    expect(await status({ ...facts, resources: [] })).toBe('missing_resource');
    expect(await status({ ...facts, versions: [] })).toBe('missing_version');
    expect(await status({ ...facts, versions: [{ ...frozen.resourceVersion, digest: '0'.repeat(64) }] })).toBe('digest_mismatch');
    const legacy = structuredClone(facts);
    delete legacy.manifest.contextItems[0].resourceVersionId;
    expect(await status(legacy)).toBe('legacy_unversioned');
    const blobPath = join(directory, 'blobs', frozen.resourceVersion.blobRef);
    await writeFile(blobPath, 'corrupt');
    expect(await status(facts)).toBe('digest_mismatch');
    await rm(blobPath);
    expect(await status(facts)).toBe('missing_blob');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
