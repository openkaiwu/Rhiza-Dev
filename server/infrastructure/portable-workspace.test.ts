import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createSeedWorkspace } from '../seed';
import { canonicalJson } from '../domain/canonical-json';
import { portableWorkspaceFacts, stripOperationalMetadata } from '../application/portable-workspace';
import { validatePortableReferences } from '../application/portable-references';
import type { PortableWorkspaceFacts } from '../application/ports/portable-workspace';
import type { BundleIndex } from '../domain/portable-bundle';
import type { BlobStorePort } from '../application/ports/host-runtime';
import { ingestPortableWorkspace, validatePortableContent, type StagedPortableWorkspace } from './portable-content';

const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
describe('portable export DTO', () => {
  it('retains purged ResourceVersion identity without exporting or ingesting its bytes', async () => {
    const workspace = createSeedWorkspace();
    const digest = 'a'.repeat(64), createdAt = workspace.updatedAt;
    workspace.resources.push({ id: 'resource', workspaceId: workspace.projectId, kind: 'attachment', logicalName: '[purged]', createdAt });
    workspace.resourceVersions.push({ id: 'version', resourceId: 'resource', version: 1, digestAlgorithm: 'sha256', digest,
      canonicalization: 'raw-v1', mediaType: 'text/plain', size: 9, blobRef: 'purged-v1', createdAt, purgedAt: createdAt });
    const facts: PortableWorkspaceFacts = { workspace, directory: { workspaceId: workspace.projectId, name: 'Workspace', status: 'active', createdBy: 'owner', revision: 1 },
      members: [{ userId: 'owner', role: 'owner' }], journal: [], provenance: [], runs: [] };
    const exported = portableWorkspaceFacts(facts, hash);
    expect(exported.workspace.resourceVersions).toEqual(workspace.resourceVersions);
    const index = { workspaceId: workspace.projectId, entries: [] } as unknown as BundleIndex;
    expect(() => validatePortableContent(exported, index)).not.toThrow();
    const putStream = vi.fn();
    const staged = { facts: exported, index, files: new Map() } as unknown as StagedPortableWorkspace;
    const ingested = await ingestPortableWorkspace(staged, { putStream } as unknown as BlobStorePort);
    expect(ingested.workspace.resourceVersions).toEqual(workspace.resourceVersions);
    expect(putStream).not.toHaveBeenCalled();
    const invalid = structuredClone(exported);
    invalid.workspace.resourceVersions[0]!.blobRef = `sha256/${digest.slice(0, 2)}/${digest}`;
    expect(() => validatePortableReferences(invalid)).toThrow(expect.objectContaining({ missingRefs: expect.arrayContaining(['version:blob-identity']) }));
    invalid.workspace.resourceVersions[0]!.blobRef = 'purged-v1';
    invalid.workspace.fileChunks.push({ id: 'chunk', attachmentId: 'attachment', ordinal: 0, text: 'erased text',
      startOffset: 0, endOffset: 11, tokens: 2, terms: [], embedding: [], resourceVersionId: 'version' });
    expect(() => validatePortableReferences(invalid)).toThrow(expect.objectContaining({ missingRefs: expect.arrayContaining(['chunk:purged-version']) }));
    invalid.workspace.fileChunks = [];
    invalid.runs.push({ id: 'run', workspaceId: workspace.projectId, nodeId: workspace.activeNodeId, commandId: 'command',
      status: 'failed', attempt: 1, input: { schemaVersion: '1.0.0', executor: { runtime: 'provider-adapter', modelSpecRef: 'model', providerEndpointRef: 'endpoint', model: 'model', provider: 'Provider' },
        request: { requestId: 'run', manifestId: 'manifest', projectId: workspace.projectId, nodeId: workspace.activeNodeId, modelId: 'model', prompt: '', history: [],
          contextItems: [{ id: 'context', title: 'erased', detail: 'erased', role: 'Reference', status: 'active', tokens: 1, sourceType: 'reference', sourceId: 'version' }], mode: 'Strict' } },
      inputHash: digest, createdAt, telemetry: { traceCount: 0 } });
    expect(() => validatePortableReferences(invalid)).toThrow(expect.objectContaining({ missingRefs: expect.arrayContaining(['run:purged-context-source']) }));
    invalid.runs[0]!.input.request.contextItems[0]!.sourceId = 'resource';
    expect(() => validatePortableReferences(invalid)).toThrow(expect.objectContaining({ missingRefs: expect.arrayContaining(['run:purged-context-source']) }));
  });
  it('normalizes encrypted locations in nested historical content without changing digests', () => {
    const digest = 'a'.repeat(64);
    const version = { id: 'version', digest, blobRef: `sealed-v1/workspace/version/${'b'.repeat(64)}/${digest}/12` };
    expect(stripOperationalMetadata({ snapshot: { resourceVersions: [version], attachments: [version] } }))
      .toEqual({ snapshot: { resourceVersions: [{ ...version, blobRef: `sha256/aa/${digest}` }], attachments: [{ ...version, blobRef: `sha256/aa/${digest}` }] } });
    expect(version.blobRef).toContain('sealed-v1/');
  });
  it('rejects a current ContextItem with an unresolved typed source', () => {
    const workspace = createSeedWorkspace();
    workspace.contextItems[0]!.sourceId = 'missing-node';
    const facts: PortableWorkspaceFacts = { workspace, directory: { workspaceId: workspace.projectId, name: 'Workspace', status: 'active', createdBy: 'owner', revision: 1 },
      members: [{ userId: 'owner', role: 'owner' }], journal: [], provenance: [], runs: [] };
    expect(() => validatePortableReferences(facts)).toThrow(expect.objectContaining({ missingRefs: expect.arrayContaining(['c1:missing-node']) }));
  });
  it('rebinds portable Run attachment snapshots to the imported scoped ResourceVersion', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-run-attachment-import-'));
    try {
      const bytes = Buffer.from('portable attachment');
      const digest = createHash('sha256').update(bytes).digest('hex');
      const path = join(directory, 'blob');
      await writeFile(path, bytes);
      const workspace = createSeedWorkspace(), createdAt = workspace.updatedAt;
      const blobRef = `sha256/${digest.slice(0, 2)}/${digest}`;
      const attachment = { id: 'attachment', name: 'file.txt', mimeType: 'text/plain', size: bytes.length, kind: 'file' as const,
        resourceId: 'resource', resourceVersionId: 'version', digest, blobRef, createdAt };
      workspace.resources.push({ id: 'resource', workspaceId: workspace.projectId, kind: 'attachment', logicalName: 'file.txt', createdAt });
      workspace.resourceVersions.push({ id: 'version', resourceId: 'resource', version: 1, digestAlgorithm: 'sha256', digest,
        canonicalization: 'raw-v1', mediaType: 'text/plain', size: bytes.length, blobRef, createdAt });
      workspace.attachments.push(attachment);
      const input = { schemaVersion: '1.0.0' as const, executor: { runtime: 'provider-adapter', modelSpecRef: 'model', providerEndpointRef: 'endpoint', model: 'model', provider: 'Provider' },
        request: { requestId: 'run', manifestId: 'manifest', projectId: workspace.projectId, nodeId: workspace.activeNodeId,
          modelId: 'model', prompt: '', history: [], contextItems: [], mode: 'Strict' as const, attachments: [structuredClone(attachment)] } };
      const facts: PortableWorkspaceFacts = { workspace, directory: { workspaceId: workspace.projectId, name: 'Workspace', status: 'active', createdBy: 'owner', revision: 1 },
        members: [{ userId: 'owner', role: 'owner' }], journal: [], provenance: [],
        runs: [{ id: 'run', workspaceId: workspace.projectId, nodeId: workspace.activeNodeId, commandId: 'command', status: 'failed', attempt: 1,
          input, inputHash: hash(input), originInputHash: 'b'.repeat(64), createdAt, telemetry: { traceCount: 0 } }] };
      const invalid = structuredClone(facts);
      invalid.runs[0]!.input.request.attachments![0]!.resourceVersionId = 'missing';
      expect(() => validatePortableReferences(invalid)).toThrow(expect.objectContaining({ missingRefs: expect.arrayContaining(['run:attachment-version']) }));
      invalid.runs[0]!.input.request.attachments![0]!.resourceVersionId = 'version';
      invalid.runs[0]!.input.request.history.push({ id: 'history', nodeId: workspace.activeNodeId, kind: 'user', text: '', createdAt, attachmentIds: ['missing-attachment'] });
      expect(() => validatePortableReferences(invalid)).toThrow(expect.objectContaining({ missingRefs: expect.arrayContaining(['run:history-attachment:missing-attachment']) }));
      const sealedRef = `sealed-v1/${workspace.projectId}/version/${'c'.repeat(64)}/${digest}/${bytes.length}`;
      const putStream = vi.fn(async (stream: AsyncIterable<Uint8Array>) => {
        const chunks: Uint8Array[] = [];
        for await (const chunk of stream) chunks.push(chunk);
        expect(Buffer.concat(chunks)).toEqual(bytes);
        return { digestAlgorithm: 'sha256' as const, digest, size: bytes.length, blobRef: sealedRef };
      });
      const index = { entries: [{ path: `blobs/sha256/${digest}`, size: bytes.length }] } as BundleIndex;
      const ingested = await ingestPortableWorkspace({ facts, index, files: new Map([[`blobs/sha256/${digest}`, path]]) } as unknown as StagedPortableWorkspace,
        { putStream } as unknown as BlobStorePort);
      expect(ingested.workspace.resourceVersions[0]!.blobRef).toBe(sealedRef);
      expect(ingested.runs[0]!.input.request.attachments?.[0]?.blobRef).toBe(sealedRef);
      expect(ingested.runs[0]!.inputHash).toBe(hash(ingested.runs[0]!.input));
      expect(ingested.runs[0]!.originInputHash).toBe(facts.runs[0]!.originInputHash);
      expect(facts.runs[0]!.input.request.attachments?.[0]?.blobRef).toBe(blobRef);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('removes operational locations and credentials at nested metadata boundaries', () => {
    const source = { text: 'User-authored relative/file discussion', origin_metadata: { username: 'private-name', path: '/private/file' },
      annotations: { internalUrl: 'https://private.test' }, nested: { api_key: 'secret', credential_ref: 'vault-key', safe: 'yes' } };
    expect(stripOperationalMetadata(source)).toEqual({ text: source.text, nested: { safe: 'yes' } });
  });
  it('preserves logical Run identity and original digest while removing endpoint location', () => {
    const workspace = createSeedWorkspace();
    const input = { schemaVersion: '1.0.0' as const, executor: { runtime: 'provider-adapter', modelSpecRef: 'model', providerEndpointRef: 'endpoint', model: 'model', provider: 'Provider' },
      request: { requestId: 'run', manifestId: 'manifest', projectId: workspace.projectId, nodeId: workspace.activeNodeId, modelId: 'model', prompt: 'User question', history: [], contextItems: [], mode: 'Strict' as const,
        modelSnapshot: { id: 'model', provider: 'Provider', model: 'model', displayName: 'Model', active: true, providerEndpointRef: 'endpoint', endpoint: { baseUrl: 'https://internal.test', chatPath: '/chat/completions', allowNoKey: false } } } };
    const originalHash = hash(input);
    const facts: PortableWorkspaceFacts = { workspace, directory: { workspaceId: workspace.projectId, name: 'Workspace', status: 'active', createdBy: 'owner', revision: 1 }, members: [{ userId: 'owner', role: 'owner' }], journal: [], provenance: [],
      runs: [{ id: 'run', workspaceId: workspace.projectId, nodeId: workspace.activeNodeId, commandId: 'command', status: 'completed', attempt: 1, input, inputHash: originalHash, createdAt: workspace.updatedAt, telemetry: { traceCount: 14 } }] };
    const exported = portableWorkspaceFacts(facts, hash);
    expect(JSON.stringify(exported)).not.toContain('internal.test');
    expect(exported.runs[0]).toMatchObject({ id: 'run', originInputHash: originalHash, telemetry: { traceCount: 0 } });
    expect(exported.runs[0].inputHash).toBe(hash(exported.runs[0].input));
    expect(exported.runs[0].inputHash).not.toBe(originalHash);
    expect(portableWorkspaceFacts(exported, hash)).toEqual(exported);
    expect(facts.runs[0].inputHash).toBe(originalHash);
    expect(facts.runs[0].input.request.modelSnapshot?.endpoint?.baseUrl).toBe('https://internal.test');
  });
});
