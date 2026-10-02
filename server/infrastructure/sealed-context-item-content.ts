import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ContextItem } from '../domain';
import { NodeContentKeys } from './node-content-keys';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { NodeSealedContentStore, type SealedContentRef } from './node-sealed-content-store';

type ContextItemContent = Pick<ContextItem, 'title' | 'detail' | 'reason' | 'content' | 'sourceRevision'>;
export interface SealedContextItemRef { format: 'rhiza.sealed-context-item.v1'; contentId: string; reference: SealedContentRef }

/** Explicit storage projection: never spread caller-owned fields into plaintext JSON. */
export function contextItemStorageProjection(item: ContextItem, contentRef: SealedContextItemRef) {
  return {
    id: item.id, title: '', detail: '', role: item.role, status: item.status, tokens: item.tokens,
    selectionMode: item.selectionMode, sourceType: item.sourceType, sourceId: item.sourceId,
    sourceNodeId: item.sourceNodeId, pinned: item.pinned, contentVersion: item.contentVersion,
    score: item.score, contentRef,
  };
}

export class SealedContextItemContent {
  static atDirectory(root: string) {
    return new SealedContextItemContent(new NodeSealedContentStore(new NodeFilesystemBlobStore(root), new NodeContentKeys(join(root, 'keys'))));
  }
  constructor(private readonly content: NodeSealedContentStore) {}
  auditKeys(references: Array<{ workspaceId: string; id: string; contentId: string }>) {
    return this.content.auditKeys(references.map(item => this.identity(item.workspaceId, item.id, item.contentId)));
  }
  /** Requires exclusive publication ownership and every workspace's references. */
  revokeUnreferencedKeys(references: Array<{ workspaceId: string; id: string; contentId: string }>) {
    return this.content.revokeUnreferencedKeys(references.map(item => this.identity(item.workspaceId, item.id, item.contentId)));
  }
  private identity(workspaceId: string, itemId: string, contentId: string) {
    if (!itemId || !contentId) throw new Error('CONTEXT_ITEM_CONTENT_IDENTITY_REQUIRED');
    return { workspaceId, contentId: JSON.stringify(['context-item-content', itemId, contentId]) };
  }
  async seal(workspaceId: string, itemId: string, item: ContextItemContent): Promise<SealedContextItemRef> {
    const contentId = randomUUID();
    const bytes = Buffer.from(JSON.stringify({ title: item.title, detail: item.detail, reason: item.reason, content: item.content, sourceRevision: item.sourceRevision }));
    try {
      return { format: 'rhiza.sealed-context-item.v1', contentId, reference: await this.content.put(this.identity(workspaceId, itemId, contentId), bytes) };
    } finally { bytes.fill(0); }
  }
  async read(workspaceId: string, itemId: string, reference: SealedContextItemRef): Promise<ContextItemContent> {
    if (reference.format !== 'rhiza.sealed-context-item.v1' || typeof reference.contentId !== 'string' || !reference.contentId || !reference.reference) throw new Error('CONTEXT_ITEM_CONTENT_REFERENCE_INVALID');
    const bytes = await this.content.read(this.identity(workspaceId, itemId, reference.contentId), reference.reference);
    try {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || typeof value.title !== 'string' || typeof value.detail !== 'string'
        || (value.reason !== undefined && typeof value.reason !== 'string')
        || (value.content !== undefined && typeof value.content !== 'string')
        || (value.sourceRevision !== undefined && (typeof value.sourceRevision !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceRevision)))
        || Object.keys(value).some(key => !['title', 'detail', 'reason', 'content', 'sourceRevision'].includes(key))) throw new Error('CONTEXT_ITEM_CONTENT_INVALID');
      return value;
    } finally { bytes.fill(0); }
  }
  destroy(workspaceId: string, itemId: string, reference: SealedContextItemRef) {
    return this.content.destroy(this.identity(workspaceId, itemId, reference.contentId));
  }
}
