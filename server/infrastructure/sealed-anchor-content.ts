import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Anchor } from '../domain';
import { NodeContentKeys } from './node-content-keys';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { NodeSealedContentStore, type SealedContentRef } from './node-sealed-content-store';

type AnchorContent = Pick<Anchor, 'selectedText'>;
export interface SealedAnchorRef { format: 'rhiza.sealed-anchor.v1'; contentId: string; reference: SealedContentRef }

export class SealedAnchorContent {
  static atDirectory(root: string) {
    return new SealedAnchorContent(new NodeSealedContentStore(new NodeFilesystemBlobStore(root), new NodeContentKeys(join(root, 'keys'))));
  }
  constructor(private readonly content: NodeSealedContentStore) {}
  auditKeys(references: Array<{ workspaceId: string; id: string; contentId: string }>) {
    return this.content.auditKeys(references.map(item => this.identity(item.workspaceId, item.id, item.contentId)));
  }
  /** Requires exclusive publication ownership and every workspace's references. */
  revokeUnreferencedKeys(references: Array<{ workspaceId: string; id: string; contentId: string }>) {
    return this.content.revokeUnreferencedKeys(references.map(item => this.identity(item.workspaceId, item.id, item.contentId)));
  }
  private identity(workspaceId: string, anchorId: string, contentId: string) {
    if (!anchorId || !contentId) throw new Error('ANCHOR_CONTENT_IDENTITY_REQUIRED');
    return { workspaceId, contentId: JSON.stringify(['anchor-content', anchorId, contentId]) };
  }
  async seal(workspaceId: string, anchorId: string, anchor: AnchorContent): Promise<SealedAnchorRef> {
    const contentId = randomUUID();
    const bytes = Buffer.from(JSON.stringify({ selectedText: anchor.selectedText }));
    try {
      return { format: 'rhiza.sealed-anchor.v1', contentId, reference: await this.content.put(this.identity(workspaceId, anchorId, contentId), bytes) };
    } finally { bytes.fill(0); }
  }
  async read(workspaceId: string, anchorId: string, reference: SealedAnchorRef): Promise<AnchorContent> {
    if (reference.format !== 'rhiza.sealed-anchor.v1' || typeof reference.contentId !== 'string' || !reference.contentId || !reference.reference) throw new Error('ANCHOR_CONTENT_REFERENCE_INVALID');
    const bytes = await this.content.read(this.identity(workspaceId, anchorId, reference.contentId), reference.reference);
    try {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || (value.selectedText !== undefined && typeof value.selectedText !== 'string')
        || Object.keys(value).some(key => key !== 'selectedText')) throw new Error('ANCHOR_CONTENT_INVALID');
      return value;
    } finally { bytes.fill(0); }
  }
  destroy(workspaceId: string, anchorId: string, reference: SealedAnchorRef) {
    return this.content.destroy(this.identity(workspaceId, anchorId, reference.contentId));
  }
}
