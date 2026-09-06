import type { ContextHistory, HistoricalContextSource } from '../domain';
import type { ContextHistoryFacts } from './ports/workspace-unit-of-work';
import type { BlobStorePort } from './ports/host-runtime';

/** Historical lookup consumes only frozen references, with no Planner or current source dependency. */
export async function resolveContextHistory(facts: ContextHistoryFacts, blobs: BlobStorePort): Promise<ContextHistory> {
  const sources = await Promise.all(facts.manifest.contextItems.map(async (item): Promise<HistoricalContextSource> => {
    const sourceId = item.sourceId;
    if (!item.resourceVersionId || !item.resourceId || !item.digest) return { sourceId, status: 'legacy_unversioned' };
    const resource = facts.resources.find(resource => resource.id === item.resourceId && resource.workspaceId === facts.manifest.projectId);
    if (!resource) return { sourceId, status: 'missing_resource' };
    const version = facts.versions.find(version => version.id === item.resourceVersionId && version.resourceId === resource.id);
    if (!version) return { sourceId, status: 'missing_version' };
    if (version.digest !== item.digest) return { sourceId, status: 'digest_mismatch' };
    try {
      const bytes = await blobs.read(version.blobRef, item.digest);
      const snapshot: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!snapshot || typeof snapshot !== 'object' || !('schemaVersion' in snapshot) || snapshot.schemaVersion !== '1.0.0' || !('content' in snapshot) || typeof snapshot.content !== 'string') return { sourceId, status: 'digest_mismatch' };
      return { sourceId, status: 'resolved', resourceVersion: version, content: snapshot.content };
    } catch (error) {
      if (error && typeof error === 'object' && 'reason' in error && error.reason === 'missing_blob') return { sourceId, status: 'missing_blob' };
      if (error instanceof SyntaxError || error instanceof TypeError || (error && typeof error === 'object' && 'code' in error && error.code === 'BLOB_INTEGRITY_ERROR')) return { sourceId, status: 'digest_mismatch' };
      throw error;
    }
  }));
  return { manifest: facts.manifest, sources };
}
