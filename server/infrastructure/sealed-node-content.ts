import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { DiscussionNode } from '../domain';
import { NodeContentKeys } from './node-content-keys';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { NodeSealedContentStore, type SealedContentRef } from './node-sealed-content-store';

type NodeContent = Pick<DiscussionNode, 'title' | 'summary' | 'anchorText'>;
export interface SealedNodeRef { format: 'rhiza.sealed-node.v1'; contentId: string; reference: SealedContentRef }

export class SealedNodeContent {
  static atDirectory(root: string) {
    return new SealedNodeContent(new NodeSealedContentStore(new NodeFilesystemBlobStore(root), new NodeContentKeys(join(root, 'keys'))));
  }
  constructor(private readonly content: NodeSealedContentStore) {}
  private identity(workspaceId: string, nodeId: string, contentId: string) {
    if (!nodeId || !contentId) throw new Error('NODE_CONTENT_IDENTITY_REQUIRED');
    return { workspaceId, contentId: JSON.stringify(['node-content', nodeId, contentId]) };
  }
  async seal(workspaceId: string, nodeId: string, node: NodeContent): Promise<SealedNodeRef> {
    const contentId = randomUUID();
    const bytes = Buffer.from(JSON.stringify({ title: node.title, summary: node.summary, anchorText: node.anchorText }));
    try {
      return { format: 'rhiza.sealed-node.v1', contentId, reference: await this.content.put(this.identity(workspaceId, nodeId, contentId), bytes) };
    } finally { bytes.fill(0); }
  }
  async read(workspaceId: string, nodeId: string, reference: SealedNodeRef): Promise<NodeContent> {
    if (reference.format !== 'rhiza.sealed-node.v1' || typeof reference.contentId !== 'string' || !reference.contentId || !reference.reference) throw new Error('NODE_CONTENT_REFERENCE_INVALID');
    const bytes = await this.content.read(this.identity(workspaceId, nodeId, reference.contentId), reference.reference);
    try {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || typeof value.title !== 'string' || typeof value.summary !== 'string'
        || (value.anchorText !== undefined && typeof value.anchorText !== 'string')
        || Object.keys(value).some(key => !['title', 'summary', 'anchorText'].includes(key))) throw new Error('NODE_CONTENT_INVALID');
      return value;
    } finally { bytes.fill(0); }
  }
  destroy(workspaceId: string, nodeId: string, reference: SealedNodeRef) {
    return this.content.destroy(this.identity(workspaceId, nodeId, reference.contentId));
  }
}
