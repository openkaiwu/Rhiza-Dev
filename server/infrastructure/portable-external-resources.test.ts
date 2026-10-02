// @vitest-environment node
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { expect, it, vi } from 'vitest';
import { exportSecurityFixture } from '../../scripts/security/export-fixture';
import { workspaceSemanticSnapshot } from '../domain-journal';
import { portableWorkspaceFacts } from '../application/portable-workspace';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { NodePortableBundle } from './portable-bundle';
import { assessPortableDocument, decodePortableDocument, ingestPortableBlobs, ingestPortableWorkspace, stagePortableWorkspace, validatePortableContent } from './portable-content';
import { BUNDLE_LIMITS } from '../domain/portable-bundle';
import { semanticStateChecksum } from './workspace-semantic-checksum';

it('exports optional resource files with exact version descriptors while preserving history, tombstones and mandatory Run envelopes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-thin-bundle-'));
  try {
    const fixture = await exportSecurityFixture(root, { attachmentText: 'Exact historical bytes' });
    const { workspace } = fixture.facts; const at = workspace.updatedAt;
    workspace.resourceVersions.push({ ...workspace.resourceVersions[0], id: 'shared-version', version: 2 });
    const blobs = new NodeFilesystemBlobStore(join(root, 'source'));
    const stored = await blobs.put(Buffer.from('Context evidence'));
    workspace.resources.push({ id: 'context-resource', workspaceId: workspace.projectId, kind: 'context-source', logicalName: 'Evidence', createdAt: at });
    workspace.resourceVersions.push({ ...stored, id: 'context-version', resourceId: 'context-resource', version: 1, canonicalization: 'raw-v1', mediaType: 'text/plain', createdAt: at });
    workspace.resourceVersions.push({ ...workspace.resourceVersions[0], id: 'purged-version', version: 3, blobRef: 'purged-v1', purgedAt: at });
    fixture.facts.journal[0].payload.snapshot = { stateSchema: 'rhiza.workspace-semantic.v1', sourceSequence: 0, state: workspaceSemanticSnapshot(workspace) };
    const input = { schemaVersion: '1.0.0' as const, executor: { runtime: 'fixture', modelSpecRef: 'model', providerEndpointRef: 'endpoint', model: 'model', provider: 'Fixture' },
      request: { requestId: 'failed-run', manifestId: 'uncommitted-manifest', projectId: workspace.projectId, nodeId: workspace.activeNodeId, modelId: 'model', prompt: 'Historical prompt', history: [], contextItems: [], mode: 'Strict' as const } };
    fixture.facts.runs.push({ id: 'failed-run', workspaceId: workspace.projectId, nodeId: workspace.activeNodeId, commandId: 'failed-command', status: 'failed', attempt: 1,
      input, inputHash: semanticStateChecksum(input), createdAt: at, telemetry: { traceCount: 0 } });
    const original = structuredClone(fixture.facts);
    const exporter = new NodePortableBundle(blobs, root); const read = vi.spyOn(blobs, 'readStream');
    const exported = await exporter.export(fixture.facts, { includeResources: false });
    const path = join(root, 'thin.rhiza');
    try { await pipeline(Readable.from(exported.bytes), createWriteStream(path)); } finally { await exported.dispose(); }
    expect(read).not.toHaveBeenCalled();
    const thin = await stagePortableWorkspace(path, undefined, root, { allowExternal: true });
    try {
      const document = JSON.parse(await readFile(thin.files.get('workspace.json')!, 'utf8'));
      expect(document.schemaVersion).toBe('3.0.0');
      expect(thin.assessment.missingResources.map(item => item.resourceVersionId).sort()).toEqual(['context-version', 'shared-version', 'version']);
      expect(thin.files.has(`blobs/sha256/${thin.facts.runs[0].inputHash}`)).toBe(true);
      expect(thin.files.has(`blobs/sha256/${workspace.resourceVersions[0].digest}`)).toBe(false);
      expect(thin.facts).toEqual(portableWorkspaceFacts(fixture.facts, value => semanticStateChecksum(value as Record<string, unknown>)));
      expect(fixture.facts).toEqual(original);
      const putStream = vi.fn(async () => ({ digestAlgorithm: 'sha256' as const, digest: 'a'.repeat(64), size: 1, blobRef: 'fixture' }));
      await expect(ingestPortableBlobs(thin, { putStream } as unknown as NodeFilesystemBlobStore)).rejects.toMatchObject({ code: 'BUNDLE_EXTERNAL_CONTENT_REQUIRED' });
      await expect(ingestPortableWorkspace(thin, { putStream } as unknown as NodeFilesystemBlobStore)).rejects.toMatchObject({ code: 'BUNDLE_EXTERNAL_CONTENT_REQUIRED' });
      expect(putStream).not.toHaveBeenCalled();
      await expect(stagePortableWorkspace(path, undefined, root)).rejects.toMatchObject({ code: 'BUNDLE_EXTERNAL_CONTENT_REQUIRED' });
      const fullPath = join(root, 'full.rhiza'); await fixture.exportTo(fullPath);
      const full = await stagePortableWorkspace(fullPath, undefined, root);
      try { expect(full.facts).toEqual(thin.facts); expect(full.assessment.missingResources).toEqual([]); } finally { await full.dispose(); }
    } finally { await thin.dispose(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('rejects forged, duplicated, undeclared or operational external descriptors using the same strict history validator', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-thin-forgery-'));
  try {
    const fixture = await exportSecurityFixture(root, { attachmentText: 'Frozen file' });
    const path = join(root, 'full.rhiza'); await fixture.exportTo(path);
    const staged = await stagePortableWorkspace(path, undefined, root);
    try {
      const document = JSON.parse(await readFile(staged.files.get('workspace.json')!, 'utf8'));
      const version = staged.facts.workspace.resourceVersions[0];
      const descriptor = { resourceId: version.resourceId, resourceVersionId: version.id, digest: version.digest, size: version.size, mediaType: version.mediaType };
      const thinDocument = { ...document, schemaVersion: '3.0.0', externalResources: [descriptor] };
      const index = { ...staged.index, entries: staged.index.entries.filter(entry => entry.path !== `blobs/sha256/${version.digest}`) };
      expect(assessPortableDocument(thinDocument, index).missingResources).toEqual([descriptor]);
      expect(() => decodePortableDocument(thinDocument, index)).toThrow('BUNDLE_EXTERNAL_CONTENT_REQUIRED');
      for (const externalResources of [[{ ...descriptor, resourceVersionId: 'unknown' }], [descriptor, descriptor],
        [{ ...descriptor, digest: 'a'.repeat(64) }], [{ ...descriptor, size: descriptor.size + 1 }], [{ ...descriptor, mediaType: 'image/png' }]]) {
        expect(() => assessPortableDocument({ ...thinDocument, externalResources }, index)).toThrow('BUNDLE_EXTERNAL_DESCRIPTOR_MISMATCH');
      }
      expect(() => assessPortableDocument({ ...thinDocument, externalResources: [] }, index)).toThrow('BUNDLE_MISSING_CONTENT');
      expect(() => assessPortableDocument({ ...thinDocument, externalResources: [{ ...descriptor, url: 'https://private.test', path: '/private/file' }] }, index)).toThrow('BUNDLE_INVALID_DOCUMENT');
      expect(() => assessPortableDocument(thinDocument, staged.index)).toThrow('BUNDLE_EXTERNAL_DESCRIPTOR_MISMATCH');
      const oversizedFacts = structuredClone(staged.facts);
      oversizedFacts.workspace.resourceVersions[0].size = BUNDLE_LIMITS.maxSingleEntryBytes + 1;
      expect(() => validatePortableContent(oversizedFacts, index, [{ ...descriptor, size: BUNDLE_LIMITS.maxSingleEntryBytes + 1 }])).toThrow('BUNDLE_QUOTA_EXCEEDED');
      const combined = { ...index, entries: [...index.entries, { path: 'other-content', digest: `sha256:${'a'.repeat(64)}`, mediaType: 'application/octet-stream', size: BUNDLE_LIMITS.maxExpandedBytes }] };
      expect(() => validatePortableContent(staged.facts, combined, [descriptor])).toThrow('BUNDLE_QUOTA_EXCEEDED');
      const corrupted = structuredClone(thinDocument); corrupted.facts.journal[0].payload.portableStateChecksum = createHash('sha256').update('wrong history').digest('hex');
      expect(() => assessPortableDocument(corrupted, index)).toThrow('BUNDLE_EVENT_STATE_MISMATCH');
      expect(() => assessPortableDocument({ ...document, schemaVersion: '9.0.0' }, index)).toThrow('BUNDLE_UNSUPPORTED_DOCUMENT');
    } finally { await staged.dispose(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
