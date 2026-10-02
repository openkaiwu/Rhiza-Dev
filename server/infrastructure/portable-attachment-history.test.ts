// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { createSeedWorkspace } from '../seed';
import { validatePortableReferences } from '../application/portable-references';
import type { PortableWorkspaceFacts } from '../application/ports/portable-workspace';
import { ingestPortableWorkspace, type StagedPortableWorkspace } from './portable-content';
import { NodeEncryptedBlobStore } from './node-encrypted-blob-store';
import { BUNDLE_MEDIA_TYPE } from '../domain/portable-bundle';

it('imports the exact historical attachment version after the current attachment has a newer version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-portable-history-'));
  try {
    const workspace = createSeedWorkspace(); const node = workspace.discussionNodes[0]; const at = new Date().toISOString();
    workspace.discussionNodes = [{ ...node, sourceNodeId: undefined, sourceMessageId: undefined }]; workspace.activeNodeId = workspace.nodeId = node.id;
    workspace.messages = []; workspace.manifests = []; workspace.contextItems = []; workspace.fileChunks = [];
    workspace.materializations = []; workspace.discussionEdges = []; workspace.anchors = []; workspace.segments = [];
    const digest = (value: string) => createHash('sha256').update(value).digest('hex');
    workspace.resources = [{ id: 'resource', workspaceId: workspace.projectId, kind: 'attachment', logicalName: 'file.txt', createdAt: at }];
    workspace.resourceVersions = ['A','B'].map((value, index) => ({ id: `version-${index+1}`, resourceId: 'resource', version: index+1, digestAlgorithm: 'sha256', digest: digest(value), canonicalization: 'raw-v1', mediaType: 'text/plain', size: 1, blobRef: `sha256/${digest(value).slice(0,2)}/${digest(value)}`, createdAt: at }));
    const attachment = (index: number) => ({ id: 'attachment', name: 'file.txt', kind: 'file' as const, mimeType: 'text/plain', size: 1, resourceId: 'resource', resourceVersionId: workspace.resourceVersions[index].id, digest: workspace.resourceVersions[index].digest, blobRef: workspace.resourceVersions[index].blobRef, createdAt: at });
    workspace.attachments = [attachment(1)];
    const facts: PortableWorkspaceFacts = { workspace, directory: { workspaceId: workspace.projectId, name: workspace.projectTitle, status: 'active', createdBy: 'owner', revision: 1 }, members: [{ userId: 'owner', role: 'owner' }], provenance: [],
      runs: [{ id: 'run', workspaceId: workspace.projectId, nodeId: node.id, commandId: 'command', status: 'failed', attempt: 1, inputHash: 'a'.repeat(64), createdAt: at, telemetry: { traceCount: 0 }, input: { schemaVersion: '1.0.0', executor: { runtime: 'fixture', modelSpecRef: 'model', providerEndpointRef: 'endpoint', model: 'model', provider: 'fixture' }, request: { requestId: 'run', manifestId: 'uncommitted-manifest', projectId: workspace.projectId, nodeId: node.id, modelId: 'model', prompt: 'fixture', history: [], contextItems: [], mode: 'Strict', attachments: [attachment(0)] } } }],
      journal: [{ eventId: 'baseline', workspaceId: workspace.projectId, sequence: 1, eventType: 'workspace.baseline.backfilled', aggregateType: 'workspace', aggregateId: workspace.projectId, aggregateRevision: 1, ceSpecversion: '1.0', envelopeVersion: '1.0.0', eventSource: 'https://rhiza.test', subject: 'workspace', dataSchema: 'https://rhiza.test/schema', actor: { actorType: 'human', actorId: 'owner' }, scope: { scopeType: 'workspace', scopeId: workspace.projectId }, commandId: 'baseline', eventIndex: 0, payload: {}, occurredAt: at, recordedAt: at }] };
    expect(() => validatePortableReferences(facts)).not.toThrow();
    const entries = workspace.resourceVersions.map(version => ({ path: `blobs/sha256/${version.digest}`, digest: `sha256:${version.digest}` as const, size: 1, mediaType: 'text/plain' }));
    const files = new Map<string,string>();
    for (const [index, entry] of entries.entries()) { const path = join(root, `blob-${index}`); await writeFile(path, index ? 'B' : 'A'); files.set(entry.path,path); }
    const staged: StagedPortableWorkspace = { directory: root, index: { mediaType: BUNDLE_MEDIA_TYPE, formatVersion: '1.0.0', workspaceId: workspace.projectId, root: 'workspace.json', entries }, files, facts, archiveDigest: 'c'.repeat(64), dispose: async () => undefined };
    const blobs = NodeEncryptedBlobStore.atDirectory(join(root,'target'));
    const imported = await ingestPortableWorkspace(staged, blobs);
    const frozen = imported.runs[0].input.request.attachments![0];
    expect(frozen.resourceVersionId).toBe('version-1'); expect(imported.workspace.attachments[0].resourceVersionId).toBe('version-2');
    expect(Buffer.from(await blobs.read(frozen.blobRef!, frozen.digest!)).toString()).toBe('A');
    expect(Buffer.from(await blobs.read(imported.workspace.attachments[0].blobRef!, imported.workspace.attachments[0].digest!)).toString()).toBe('B');
    const corrupted = structuredClone(facts); corrupted.runs[0].input.request.attachments![0].digest = 'f'.repeat(64);
    expect(() => validatePortableReferences(corrupted)).toThrow('BUNDLE_BROKEN_REFERENCES');
  } finally { await rm(root, { recursive: true, force: true }); }
});
