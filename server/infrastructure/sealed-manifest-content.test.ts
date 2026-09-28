import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { ContextManifest } from '../domain';
import { manifestReferenceProjection, SealedManifestContent } from './sealed-manifest-content';

it('keeps frozen resource evidence but encrypts authored Manifest metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-manifest-content-'));
  try {
    const manifest: ContextManifest = {
      id: 'manifest', projectId: 'workspace', nodeId: 'node', requestId: 'request', createdAt: '2026-09-09T00:00:00Z', mode: 'Auto', model: 'model', provider: 'provider', runtime: 'provider-adapter',
      schemaVersion: '1.0.0', versions: { planner: '1', compiler: '1', contributors: { node: '1' }, tokenizer: '1', selectionPolicy: '1' },
      contextItemIds: ['node'], excludedItemIds: [], attachmentIds: [], estimatedTokens: 10, operation: 'send', generation: { temperature: 0.4, topP: 1, maxTokens: 100 },
      contextItems: [{ sourceType: 'node', sourceId: 'node', title: 'private title', detail: 'private detail', role: 'Reference', selectionMode: 'AUTO_RETRIEVED', pinned: false, reason: 'private reason', tokenCount: 10, contentVersion: 1, resourceId: 'resource', resourceVersionId: 'version', digest: 'a'.repeat(64), contributorVersion: '1', priority: 1 }],
    };
    const projection = manifestReferenceProjection(manifest);
    expect(JSON.stringify(projection)).not.toContain('private');
    expect(projection.contextItems[0]).toMatchObject({ resourceId: 'resource', resourceVersionId: 'version', digest: 'a'.repeat(64), reason: '[sealed]' });
    const content = SealedManifestContent.atDirectory(root);
    const reference = await content.seal(manifest);
    expect(await SealedManifestContent.atDirectory(root).read('workspace', 'manifest', reference, projection)).toEqual(manifest);
    await expect(content.read('workspace', 'manifest', reference, { ...projection, contextItems: [] })).rejects.toThrow('MANIFEST_CONTENT_IDENTITY_MISMATCH');
    await expect(content.read('other', 'manifest', reference, projection)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await content.destroy('workspace', 'manifest', reference);
    await expect(content.read('workspace', 'manifest', reference, projection)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
  } finally { await rm(root, { recursive: true, force: true }); }
});
