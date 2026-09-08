import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ContextManifest } from '../domain';
import { NodeContentKeys } from './node-content-keys';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { NodeSealedContentStore, type SealedContentRef } from './node-sealed-content-store';
import { semanticStateChecksum } from './workspace-semantic-checksum';

export interface SealedManifestRef { format: 'rhiza.sealed-manifest.v1'; contentId: string; reference: SealedContentRef }

/** Retain fields consumed by the frozen-context SQL validator, not authored descriptions. */
export function manifestReferenceProjection(manifest: ContextManifest) {
  return {
    schemaVersion: manifest.schemaVersion, versions: manifest.versions,
    contextItems: manifest.contextItems.map(item => ({
      resourceId: item.resourceId, resourceVersionId: item.resourceVersionId, digest: item.digest,
      contributorVersion: item.contributorVersion, selectionMode: item.selectionMode, priority: item.priority,
      reason: item.reason ? '[sealed]' : '',
      originResourceVersionId: item.originResourceVersionId, originDigest: item.originDigest,
    })),
  };
}

export class SealedManifestContent {
  static atDirectory(root: string) {
    return new SealedManifestContent(new NodeSealedContentStore(new NodeFilesystemBlobStore(root), new NodeContentKeys(join(root, 'keys'))));
  }
  constructor(private readonly content: NodeSealedContentStore) {}
  /** Requires exclusive publication ownership and references from every workspace. */
  revokeUnreferencedKeys(references: Array<{ workspaceId: string; id: string; contentId: string }>) {
    return this.content.revokeUnreferencedKeys(references.map(item => this.identity(item.workspaceId, item.id, item.contentId)));
  }
  auditKeys(references: Array<{ workspaceId: string; id: string; contentId: string }>) {
    return this.content.auditKeys(references.map(item => this.identity(item.workspaceId, item.id, item.contentId)));
  }
  private identity(workspaceId: string, manifestId: string, contentId: string) {
    if (!manifestId || !contentId) throw new Error('MANIFEST_CONTENT_IDENTITY_REQUIRED');
    return { workspaceId, contentId: JSON.stringify(['context-manifest', manifestId, contentId]) };
  }
  async seal(manifest: ContextManifest): Promise<SealedManifestRef> {
    const contentId = randomUUID();
    const bytes = Buffer.from(JSON.stringify(manifest));
    try {
      return { format: 'rhiza.sealed-manifest.v1', contentId, reference: await this.content.put(this.identity(manifest.projectId, manifest.id, contentId), bytes) };
    } finally { bytes.fill(0); }
  }
  async read(workspaceId: string, manifestId: string, reference: SealedManifestRef, projection: Record<string, unknown>): Promise<ContextManifest> {
    if (reference.format !== 'rhiza.sealed-manifest.v1' || typeof reference.contentId !== 'string' || !reference.contentId || !reference.reference) throw new Error('MANIFEST_CONTENT_REFERENCE_INVALID');
    const bytes = await this.content.read(this.identity(workspaceId, manifestId, reference.contentId), reference.reference);
    try {
      const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as ContextManifest;
      if (manifest.projectId !== workspaceId || manifest.id !== manifestId
        || semanticStateChecksum(manifestReferenceProjection(manifest)) !== semanticStateChecksum(projection)) throw new Error('MANIFEST_CONTENT_IDENTITY_MISMATCH');
      return manifest;
    } finally { bytes.fill(0); }
  }
  destroy(workspaceId: string, manifestId: string, reference: SealedManifestRef) {
    return this.content.destroy(this.identity(workspaceId, manifestId, reference.contentId));
  }
}
