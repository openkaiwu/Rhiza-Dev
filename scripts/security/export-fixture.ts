import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createSeedWorkspace } from '../../server/seed';
import { workspaceSemanticSnapshot } from '../../server/domain-journal';
import type { PortableWorkspaceFacts } from '../../server/application/ports/portable-workspace';
import { NodeFilesystemBlobStore } from '../../server/infrastructure/node-host-runtime';
import { NodePortableBundle } from '../../server/infrastructure/portable-bundle';

/** Synthetic, isolated fixtures for the export regression and real detector controls. */
export async function exportSecurityFixture(root: string, options: { text?: string; attachmentText?: string; metadata?: Record<string, unknown> } = {}) {
  const workspace = createSeedWorkspace();
  workspace.projectId = randomUUID(); workspace.contextItems = []; workspace.messages = []; workspace.manifests = []; workspace.auditEvents = [];
  const at = workspace.updatedAt;
  workspace.messages.push({ id: 'message', nodeId: workspace.activeNodeId, kind: 'user', text: options.text ?? 'Ordinary business discussion', createdAt: at });
  const blobs = new NodeFilesystemBlobStore(join(root, 'source'));
  if (options.attachmentText) {
    const blob = await blobs.put(Buffer.from(options.attachmentText));
    workspace.resources.push({ id: 'resource', workspaceId: workspace.projectId, kind: 'attachment', logicalName: 'notes.txt', createdAt: at });
    workspace.resourceVersions.push({ id: 'version', resourceId: 'resource', version: 1, canonicalization: 'raw-v1', mediaType: 'text/plain', ...blob, createdAt: at });
    workspace.attachments.push({ id: 'attachment', name: 'notes.txt', kind: 'file', mimeType: 'text/plain', resourceId: 'resource', resourceVersionId: 'version',
      digest: blob.digest, blobRef: blob.blobRef, size: blob.size, createdAt: at });
  }
  const facts: PortableWorkspaceFacts = { workspace,
    directory: { workspaceId: workspace.projectId, name: 'Security fixture', status: 'active', createdBy: 'owner', revision: 1 },
    members: [{ userId: 'owner', role: 'owner' }], runs: [], provenance: [],
    journal: [{ eventId: randomUUID(), workspaceId: workspace.projectId, sequence: 1, ceSpecversion: '1.0', envelopeVersion: '1.0.0',
      eventType: 'workspace.baseline.backfilled', eventSource: 'urn:rhiza:fixture', subject: 'workspace', dataSchema: 'urn:rhiza:fixture:schema',
      aggregateType: 'workspace', aggregateId: workspace.projectId, aggregateRevision: 1, actor: { actorType: 'human', actorId: 'owner' },
      scope: { scopeType: 'workspace', scopeId: workspace.projectId }, commandId: 'fixture', eventIndex: 0, occurredAt: at, recordedAt: at,
      payload: { snapshot: { stateSchema: 'rhiza.workspace-semantic.v1', sourceSequence: 0, state: workspaceSemanticSnapshot(workspace) }, ...options.metadata } }],
  };
  const exporter = new NodePortableBundle(blobs, root);
  return { facts, exportTo: async (path: string, source = facts) => {
    const exported = await exporter.export(source);
    try { await pipeline(Readable.from(exported.bytes), createWriteStream(path, { flags: 'wx', mode: 0o600 })); }
    finally { await exported.dispose(); }
  } };
}
