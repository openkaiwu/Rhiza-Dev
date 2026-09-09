import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Resource } from '../domain';
import { NodeContentKeys } from './node-content-keys';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { NodeSealedContentStore, type SealedContentRef } from './node-sealed-content-store';

type ResourceContent = Pick<Resource, 'logicalName'>;
export interface SealedResourceRef { format: 'rhiza.sealed-resource.v1'; contentId: string; reference: SealedContentRef }

export class SealedResourceContent {
  static atDirectory(root: string) {
    return new SealedResourceContent(new NodeSealedContentStore(new NodeFilesystemBlobStore(root), new NodeContentKeys(join(root, 'keys'))));
  }
  constructor(private readonly content: NodeSealedContentStore) {}
  auditKeys(references: Array<{ workspaceId: string; id: string; contentId: string }>) {
    return this.content.auditKeys(references.map(item => this.identity(item.workspaceId, item.id, item.contentId)));
  }
  /** Requires exclusive publication ownership and every workspace's references. */
  revokeUnreferencedKeys(references: Array<{ workspaceId: string; id: string; contentId: string }>) {
    return this.content.revokeUnreferencedKeys(references.map(item => this.identity(item.workspaceId, item.id, item.contentId)));
  }
  private identity(workspaceId: string, resourceId: string, contentId: string) {
    if (!resourceId || !contentId) throw new Error('RESOURCE_CONTENT_IDENTITY_REQUIRED');
    return { workspaceId, contentId: JSON.stringify(['resource-content', resourceId, contentId]) };
  }
  async seal(workspaceId: string, resourceId: string, resource: ResourceContent): Promise<SealedResourceRef> {
    const contentId = randomUUID();
    const bytes = Buffer.from(JSON.stringify({ logicalName: resource.logicalName }));
    try {
      return { format: 'rhiza.sealed-resource.v1', contentId, reference: await this.content.put(this.identity(workspaceId, resourceId, contentId), bytes) };
    } finally { bytes.fill(0); }
  }
  async read(workspaceId: string, resourceId: string, reference: SealedResourceRef): Promise<ResourceContent> {
    if (reference.format !== 'rhiza.sealed-resource.v1' || typeof reference.contentId !== 'string' || !reference.contentId || !reference.reference) throw new Error('RESOURCE_CONTENT_REFERENCE_INVALID');
    const bytes = await this.content.read(this.identity(workspaceId, resourceId, reference.contentId), reference.reference);
    try {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || typeof value.logicalName !== 'string'
        || Object.keys(value).some(key => key !== 'logicalName')) throw new Error('RESOURCE_CONTENT_INVALID');
      return value;
    } finally { bytes.fill(0); }
  }
  destroy(workspaceId: string, resourceId: string, reference: SealedResourceRef) {
    return this.content.destroy(this.identity(workspaceId, resourceId, reference.contentId));
  }
}
