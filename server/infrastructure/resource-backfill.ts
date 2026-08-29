import { createHash } from 'node:crypto';
import type { HostRuntimePort } from '../application/ports/host-runtime';
import type { Resource, ResourceMaterialization, ResourceVersion } from '../domain';
import type { WorkspaceRepository } from '../store';

export interface ResourceBackfillResult {
  migrated: number;
  dangling: number;
  checksum: string;
  blobRefs: string[];
}

function checksum(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Repeatable legacy attachment backfill. A promoted blob may outlive a failed DB commit and is reclaimed by orphan GC. */
export async function backfillWorkspaceResources(repository: WorkspaceRepository, host: HostRuntimePort): Promise<ResourceBackfillResult> {
  const before = await repository.read();
  let migrated = 0;
  const promoted = new Map<string, Awaited<ReturnType<HostRuntimePort['blobs']['put']>>>();
  for (const attachment of before.attachments) {
    if (attachment.blobRef && attachment.digest) {
      await host.blobs.read(attachment.blobRef, attachment.digest);
      continue;
    }
    if (!host.readLegacyAttachment) throw Object.assign(new Error(`Legacy attachment ${attachment.id} cannot be read by this host`), { code: 'RESOURCE_BACKFILL_UNAVAILABLE' });
    promoted.set(attachment.id, await host.blobs.put(await host.readLegacyAttachment(attachment.id)));
  }
  if (promoted.size) await repository.update(current => {
    const resources = [...current.resources];
    const versions = [...current.resourceVersions];
    const materializations = [...current.materializations];
    const attachments = current.attachments.map(attachment => {
      const blob = promoted.get(attachment.id);
      if (!blob || (attachment.blobRef && attachment.digest)) return attachment;
      const resourceId = attachment.id;
      const resourceVersionId = `resource:${attachment.id}:v1`;
      const materializationId = `materialization:${attachment.id}:v1:file-chunks`;
      const resource: Resource = { id: resourceId, workspaceId: current.projectId, kind: 'attachment', logicalName: attachment.name, createdAt: attachment.createdAt };
      const version: ResourceVersion = { id: resourceVersionId, resourceId, version: 1, digestAlgorithm: blob.digestAlgorithm, digest: blob.digest, canonicalization: 'raw-v1', mediaType: attachment.mimeType, size: blob.size, blobRef: blob.blobRef, createdAt: attachment.createdAt };
      const materialization: ResourceMaterialization = { id: materializationId, resourceVersionId, kind: 'file-chunks', generator: 'legacy-context-planner-v1', createdAt: attachment.createdAt };
      if (!resources.some(item => item.id === resourceId)) resources.push(resource);
      if (!versions.some(item => item.id === resourceVersionId)) versions.push(version);
      if (!materializations.some(item => item.id === materializationId)) materializations.push(materialization);
      migrated += 1;
      return { ...attachment, resourceId, resourceVersionId, digest: blob.digest, blobRef: blob.blobRef };
    });
    return { ...current, attachments, resources, resourceVersions: versions, materializations, fileChunks: current.fileChunks.map(chunk => {
      const attachment = attachments.find(item => item.id === chunk.attachmentId);
      return attachment?.resourceVersionId ? { ...chunk, resourceVersionId: attachment.resourceVersionId } : chunk;
    }) };
  });
  const after = await repository.read();
  const versionIds = new Set(after.resourceVersions.map(item => item.id));
  const dangling = after.attachments.filter(item => !item.resourceId || !item.resourceVersionId || !item.digest || !item.blobRef || !versionIds.has(item.resourceVersionId)).length;
  const snapshot = after.attachments.map(item => ({ id: item.id, resourceId: item.resourceId, resourceVersionId: item.resourceVersionId, digest: item.digest, blobRef: item.blobRef })).sort((a, b) => a.id.localeCompare(b.id));
  return { migrated, dangling, checksum: checksum(snapshot), blobRefs: [...new Set(snapshot.flatMap(item => item.blobRef ? [item.blobRef] : []))].sort() };
}
