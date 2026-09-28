import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { StoredAttachment } from '../domain';
import { NodeContentKeys } from './node-content-keys';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { NodeSealedContentStore, type SealedContentRef } from './node-sealed-content-store';

type AttachmentContent = Pick<StoredAttachment, 'name' | 'extractedText' | 'summary'>;
export interface SealedAttachmentRef { format: 'rhiza.sealed-attachment.v1'; contentId: string; reference: SealedContentRef }

export class SealedAttachmentContent {
  static atDirectory(root: string) {
    return new SealedAttachmentContent(new NodeSealedContentStore(new NodeFilesystemBlobStore(root), new NodeContentKeys(join(root, 'keys'))));
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
    if (!itemId || !contentId) throw new Error('ATTACHMENT_CONTENT_IDENTITY_REQUIRED');
    return { workspaceId, contentId: JSON.stringify(['attachment-content', itemId, contentId]) };
  }
  async seal(workspaceId: string, itemId: string, item: AttachmentContent): Promise<SealedAttachmentRef> {
    const contentId = randomUUID();
    const bytes = Buffer.from(JSON.stringify({ name: item.name, extractedText: item.extractedText, summary: item.summary }));
    try {
      return { format: 'rhiza.sealed-attachment.v1', contentId, reference: await this.content.put(this.identity(workspaceId, itemId, contentId), bytes) };
    } finally { bytes.fill(0); }
  }
  async read(workspaceId: string, itemId: string, reference: SealedAttachmentRef): Promise<AttachmentContent> {
    if (reference.format !== 'rhiza.sealed-attachment.v1' || typeof reference.contentId !== 'string' || !reference.contentId || !reference.reference) throw new Error('ATTACHMENT_CONTENT_REFERENCE_INVALID');
    const bytes = await this.content.read(this.identity(workspaceId, itemId, reference.contentId), reference.reference);
    try {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || typeof value.name !== 'string'
        || (value.extractedText !== undefined && typeof value.extractedText !== 'string')
        || (value.summary !== undefined && typeof value.summary !== 'string')
        || Object.keys(value).some(key => !['name', 'extractedText', 'summary'].includes(key))) throw new Error('ATTACHMENT_CONTENT_INVALID');
      return value;
    } finally { bytes.fill(0); }
  }
  destroy(workspaceId: string, itemId: string, reference: SealedAttachmentRef) {
    return this.content.destroy(this.identity(workspaceId, itemId, reference.contentId));
  }
}
