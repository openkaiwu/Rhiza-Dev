// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { loadMigrations } from '../scripts/migrate';
import { PostgresWorkspaceStore } from '../server/postgres-store';
import { NodeEncryptedBlobStore } from '../server/infrastructure/node-encrypted-blob-store';
import { NodeFilesystemBlobStore } from '../server/infrastructure/node-host-runtime';
import { semanticChecksum, semanticStateChecksum } from '../server/infrastructure/workspace-semantic-checksum';
import { portableWorkspaceFacts } from '../server/application/portable-workspace';
import { validatePortableHistory } from '../server/application/portable-history';
import { workspaceSemanticSnapshot } from '../server/domain-journal';
import type { ContextManifest } from '../server/domain';
import type { ExecutionRun } from '../server/execution-runtime/run';

it.skipIf(!process.env.DATABASE_URL)('migrates a populated PostgreSQL Workspace in bounded, repeatable batches', async () => {
  const connectionString = process.env.DATABASE_URL!;
  const admin = new Pool({ connectionString });
  const schema = `m09_migration_${randomUUID().replaceAll('-', '')}`;
  const directory = await mkdtemp(join(tmpdir(), 'rhiza-m09-migration-'));
  await admin.query(`CREATE SCHEMA ${schema}`);
  const scopedUrl = new URL(connectionString);
  scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
  const database = new Pool({ connectionString: scopedUrl.toString() });
  const workspaceId = randomUUID();
  const legacy = new PostgresWorkspaceStore(database, workspaceId);
  const sealed = PostgresWorkspaceStore.fromConnectionString(scopedUrl.toString(), workspaceId, directory);
  const uploadDirectory = join(directory, 'uploads');
  const rawBlobs = new NodeFilesystemBlobStore(uploadDirectory);
  const encryptedBlobs = NodeEncryptedBlobStore.atDirectory(uploadDirectory);
  try {
    for (const migration of await loadMigrations()) await database.query(migration.sql);
    await legacy.read();
    await legacy.workspaceDirectory.ensureWorkspace({ workspaceId, name: 'Migration fixture', status: 'active', createdBy: randomUUID(), revision: 1 });
    const resourceId = randomUUID(), versionId = randomUUID(), attachmentId = randomUUID(), manifestId = randomUUID();
    const bytes = new TextEncoder().encode('legacy resource bytes');
    const raw = await rawBlobs.put(bytes);
    const createdAt = new Date().toISOString();
    const source = await legacy.read();
    const branchId = randomUUID();
    const manifest: ContextManifest = { id: manifestId, projectId: workspaceId, nodeId: source.activeNodeId,
      requestId: randomUUID(), createdAt, mode: 'Assisted', provider: 'Test', model: 'legacy-model', runtime: 'provider-adapter',
      contextItemIds: [], excludedItemIds: [], contextItems: [], estimatedTokens: 0,
      generation: { temperature: 0.4, topP: 1, maxTokens: 1024 }, operation: 'send', attachmentIds: [] };
    await legacy.update(current => ({ ...current,
      resources: [...current.resources, { id: resourceId, workspaceId, kind: 'attachment', logicalName: 'legacy resource', createdAt }],
      resourceVersions: [...current.resourceVersions, { id: versionId, resourceId, version: 1, digestAlgorithm: 'sha256',
        digest: raw.digest, canonicalization: 'raw-v1', mediaType: 'text/plain', size: raw.size, blobRef: raw.blobRef, createdAt }],
      materializations: [...current.materializations, { id: randomUUID(), resourceVersionId: versionId, kind: 'file-chunks', generator: 'legacy-context-planner-v1', createdAt }],
      attachments: [...current.attachments, { id: attachmentId, name: 'legacy.txt', mimeType: 'text/plain', size: raw.size,
        kind: 'file', extractedText: 'legacy extracted text', summary: 'legacy summary', chunkCount: 1,
        resourceId, resourceVersionId: versionId, digest: raw.digest, blobRef: raw.blobRef, createdAt }],
      fileChunks: [...current.fileChunks, { id: randomUUID(), attachmentId, ordinal: 0, text: 'legacy chunk',
        startOffset: 0, endOffset: 12, tokens: 2, terms: ['legacy'], embedding: [], resourceVersionId: versionId }],
      discussionNodes: [...current.discussionNodes, { id: branchId, title: 'legacy branch', summary: 'legacy summary',
        status: 'active', kind: 'branch', sourceNodeId: current.activeNodeId, x: 1, y: 1, createdAt, updatedAt: createdAt }],
      discussionEdges: [...current.discussionEdges, { id: randomUUID(), source: current.activeNodeId, target: branchId,
        relation: 'derived-from', label: 'legacy relation', createdAt }],
      anchors: [...current.anchors, { id: randomUUID(), nodeId: current.activeNodeId, messageId: current.messages[0]!.id,
        selectedText: 'legacy quote', startOffset: 0, endOffset: 12, createdAt }],
      manifests: [...current.manifests, manifest],
    }));
    await legacy.backfillJournal();
    const runId = randomUUID();
    const input = { schemaVersion: '1.0.0' as const, request: { requestId: runId, manifestId, projectId: workspaceId,
      nodeId: source.activeNodeId, modelId: 'legacy-model', prompt: 'legacy Run input', history: [], contextItems: [], mode: 'Assisted' as const },
      executor: { runtime: 'provider-adapter', modelSpecRef: 'legacy-model', providerEndpointRef: 'legacy-endpoint', model: 'legacy-model', provider: 'Test' } };
    const run: ExecutionRun = { id: runId, workspaceId, nodeId: source.activeNodeId, commandId: runId, status: 'created',
      attempt: 1, input, inputHash: semanticStateChecksum(input), createdAt, telemetry: { traceCount: 0 } };
    const context = (commandId: string) => ({ commandId, commandType: 'MigrationFixture',
      actor: { actorType: 'human' as const, actorId: randomUUID() }, scope: { scopeType: 'workspace' as const, scopeId: workspaceId }, occurredAt: createdAt });
    await legacy.executeCommand({ context: context(runId), options: { run: { kind: 'create', run } },
      apply: async current => ({ next: current, value: { fixture: 'legacy success' } }),
      events: () => [{ eventType: 'workspace.renamed', aggregateType: 'workspace', aggregateId: workspaceId, payload: {} }] });
    await expect(legacy.executeCommand({ context: context(randomUUID()),
      apply: async () => { throw Object.assign(new Error('legacy rejected body'), { code: 'LEGACY_REJECTED', status: 400 }); },
      events: () => [] })).rejects.toThrow('legacy rejected body');
    const checksum = semanticChecksum(await legacy.read());
    const before = await legacy.auditLegacyPlaintextReplicas();
    for (const family of ['receipt_results', 'receipt_errors', 'run_inputs', 'journal_payloads', 'messages', 'manifests', 'nodes',
      'segments', 'anchors', 'edges', 'attachments', 'resources', 'resource_blobs', 'context_items', 'file_chunks'] as const) {
      expect(before[family]).toBeGreaterThan(0);
    }
    await sealed.acquireRuntimeOwnership();
    const methods = [
      'sealLegacyReceiptResults', 'sealLegacyReceiptErrors', 'sealLegacyRunInputs', 'sealLegacyJournalPayloads',
      'sealLegacyMessageContent', 'sealLegacyManifestContent', 'sealLegacyNodeContent', 'sealLegacySegmentContent',
      'sealLegacyAnchorContent', 'sealLegacyEdgeContent', 'sealLegacyAttachmentContent', 'sealLegacyContextItems',
      'sealLegacyFileChunks', 'sealLegacyResourceContent',
    ] as const;
    for (const method of methods) {
      let migrated = 0;
      let batch: number;
      do { batch = await sealed[method](1); migrated += batch; } while (batch === 1);
      expect(migrated).toBe(before[{
        sealLegacyReceiptResults: 'receipt_results', sealLegacyReceiptErrors: 'receipt_errors', sealLegacyRunInputs: 'run_inputs',
        sealLegacyJournalPayloads: 'journal_payloads', sealLegacyMessageContent: 'messages', sealLegacyManifestContent: 'manifests',
        sealLegacyNodeContent: 'nodes', sealLegacySegmentContent: 'segments', sealLegacyAnchorContent: 'anchors',
        sealLegacyEdgeContent: 'edges', sealLegacyAttachmentContent: 'attachments', sealLegacyContextItems: 'context_items',
        sealLegacyFileChunks: 'file_chunks', sealLegacyResourceContent: 'resources',
      }[method]]);
      expect(await sealed[method](1)).toBe(0);
    }
    expect(semanticChecksum(await sealed.read())).toBe(checksum);
    expect(await sealed.sealLegacyResourceBlobs(rawBlobs, encryptedBlobs, 1)).toBe(1);
    expect(await sealed.sealLegacyResourceBlobs(rawBlobs, encryptedBlobs, 1)).toBe(0);
    expect(Object.values(await sealed.auditLegacyPlaintextReplicas()).every(count => count === 0)).toBe(true);
    const version = (await sealed.read()).resourceVersions.find(item => item.id === versionId)!;
    expect(version.blobRef).toMatch(/^sealed-v1\//);
    expect(Buffer.from(await encryptedBlobs.read(version.blobRef, version.digest))).toEqual(Buffer.from(bytes));
    const portable = portableWorkspaceFacts(await sealed.readPortableWorkspace(), input => semanticStateChecksum(input as Record<string, unknown>));
    expect(validatePortableHistory(portable, semanticStateChecksum)).toBe(semanticStateChecksum(workspaceSemanticSnapshot(portable.workspace)));
    expect(await sealed.reclaimLegacyResourceFiles(uploadDirectory, encryptedBlobs, 1)).toEqual({ resourceBlobs: 1, attachments: 0 });
    expect(await sealed.reclaimLegacyResourceFiles(uploadDirectory, encryptedBlobs, 1)).toEqual({ resourceBlobs: 0, attachments: 0 });
    expect(Buffer.from(await encryptedBlobs.read(version.blobRef, version.digest))).toEqual(Buffer.from(bytes));
  } finally {
    await sealed.close();
    await database.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
