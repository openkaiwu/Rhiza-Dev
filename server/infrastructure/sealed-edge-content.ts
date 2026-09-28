import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { DiscussionEdge } from '../domain';
import { NodeContentKeys } from './node-content-keys';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { NodeSealedContentStore, type SealedContentRef } from './node-sealed-content-store';

type EdgeContent = Pick<DiscussionEdge, 'label'>;
export interface SealedEdgeRef { format: 'rhiza.sealed-edge.v1'; contentId: string; reference: SealedContentRef }

export class SealedEdgeContent {
  static atDirectory(root: string) {
    return new SealedEdgeContent(new NodeSealedContentStore(new NodeFilesystemBlobStore(root), new NodeContentKeys(join(root, 'keys'))));
  }
  constructor(private readonly content: NodeSealedContentStore) {}
  auditKeys(references: Array<{ workspaceId: string; id: string; contentId: string }>) {
    return this.content.auditKeys(references.map(item => this.identity(item.workspaceId, item.id, item.contentId)));
  }
  /** Requires exclusive publication ownership and every workspace's references. */
  revokeUnreferencedKeys(references: Array<{ workspaceId: string; id: string; contentId: string }>) {
    return this.content.revokeUnreferencedKeys(references.map(item => this.identity(item.workspaceId, item.id, item.contentId)));
  }
  private identity(workspaceId: string, edgeId: string, contentId: string) {
    if (!edgeId || !contentId) throw new Error('EDGE_CONTENT_IDENTITY_REQUIRED');
    return { workspaceId, contentId: JSON.stringify(['edge-content', edgeId, contentId]) };
  }
  async seal(workspaceId: string, edgeId: string, edge: EdgeContent): Promise<SealedEdgeRef> {
    const contentId = randomUUID();
    const bytes = Buffer.from(JSON.stringify({ label: edge.label }));
    try {
      return { format: 'rhiza.sealed-edge.v1', contentId, reference: await this.content.put(this.identity(workspaceId, edgeId, contentId), bytes) };
    } finally { bytes.fill(0); }
  }
  async read(workspaceId: string, edgeId: string, reference: SealedEdgeRef): Promise<EdgeContent> {
    if (reference.format !== 'rhiza.sealed-edge.v1' || typeof reference.contentId !== 'string' || !reference.contentId || !reference.reference) throw new Error('EDGE_CONTENT_REFERENCE_INVALID');
    const bytes = await this.content.read(this.identity(workspaceId, edgeId, reference.contentId), reference.reference);
    try {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || typeof value.label !== 'string'
        || Object.keys(value).some(key => key !== 'label')) throw new Error('EDGE_CONTENT_INVALID');
      return value;
    } finally { bytes.fill(0); }
  }
  destroy(workspaceId: string, edgeId: string, reference: SealedEdgeRef) {
    return this.content.destroy(this.identity(workspaceId, edgeId, reference.contentId));
  }
}
