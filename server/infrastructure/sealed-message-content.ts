import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { StoredMessage } from '../domain';
import { NodeContentKeys } from './node-content-keys';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { NodeSealedContentStore, type SealedContentRef } from './node-sealed-content-store';

export type MessageContent = Pick<StoredMessage, 'text' | 'reasoning' | 'toolCalls'>;
export interface SealedMessageRef { format: 'rhiza.sealed-message.v1'; contentId: string; reference: SealedContentRef }

export class SealedMessageContent {
  static atDirectory(root: string) {
    return new SealedMessageContent(new NodeSealedContentStore(new NodeFilesystemBlobStore(root), new NodeContentKeys(join(root, 'keys'))));
  }
  constructor(private readonly content: NodeSealedContentStore) {}
  auditKeys(references: Array<{ workspaceId: string; id: string; contentId: string }>) {
    return this.content.auditKeys(references.map(item => this.identity(item.workspaceId, item.id, item.contentId)));
  }
  private identity(workspaceId: string, messageId: string, contentId: string) {
    if (!messageId || !contentId) throw new Error('MESSAGE_CONTENT_IDENTITY_REQUIRED');
    return { workspaceId, contentId: JSON.stringify(['message-content', messageId, contentId]) };
  }
  async seal(workspaceId: string, messageId: string, message: MessageContent): Promise<SealedMessageRef> {
    const contentId = randomUUID();
    // Select content explicitly: callers may supply the complete message record.
    const bytes = Buffer.from(JSON.stringify({ text: message.text, reasoning: message.reasoning, toolCalls: message.toolCalls }));
    try {
      return { format: 'rhiza.sealed-message.v1', contentId, reference: await this.content.put(this.identity(workspaceId, messageId, contentId), bytes) };
    } finally { bytes.fill(0); }
  }
  async read(workspaceId: string, messageId: string, reference: SealedMessageRef): Promise<MessageContent> {
    if (reference.format !== 'rhiza.sealed-message.v1' || typeof reference.contentId !== 'string' || !reference.contentId || !reference.reference) throw new Error('MESSAGE_CONTENT_REFERENCE_INVALID');
    const bytes = await this.content.read(this.identity(workspaceId, messageId, reference.contentId), reference.reference);
    try {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.text !== 'string'
        || (value.reasoning !== undefined && typeof value.reasoning !== 'string')
        || (value.toolCalls !== undefined && !Array.isArray(value.toolCalls))
        || Object.keys(value).some(key => !['text', 'reasoning', 'toolCalls'].includes(key))) throw new Error('MESSAGE_CONTENT_INVALID');
      return value;
    } finally { bytes.fill(0); }
  }
  destroy(workspaceId: string, messageId: string, reference: SealedMessageRef) {
    return this.content.destroy(this.identity(workspaceId, messageId, reference.contentId));
  }
}
