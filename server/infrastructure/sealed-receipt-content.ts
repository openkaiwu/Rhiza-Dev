import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { NodeContentKeys } from './node-content-keys';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { NodeSealedContentStore, type SealedContentRef } from './node-sealed-content-store';

export interface SealedReceiptRef { format: 'rhiza.sealed-receipt.v1'; contentId: string; reference: SealedContentRef }
export type ReceiptContentKind = 'result' | 'error';

export class SealedReceiptContent {
  static atDirectory(root: string) {
    return new SealedReceiptContent(new NodeSealedContentStore(new NodeFilesystemBlobStore(root), new NodeContentKeys(join(root, 'keys'))));
  }
  constructor(private readonly content: NodeSealedContentStore) {}
  auditKeys(references: Array<{ workspaceId: string; commandId: string; reference: SealedReceiptRef; kind: ReceiptContentKind }>) {
    return this.content.auditKeys(references.map(item => this.identity(item.workspaceId, item.commandId, item.reference.contentId, item.kind)));
  }
  private identity(workspaceId: string, commandId: string, contentId: string, kind: ReceiptContentKind) {
    return { workspaceId, contentId: JSON.stringify([kind === 'result' ? 'command-receipt' : 'command-receipt-error', commandId, contentId]) };
  }
  async seal(workspaceId: string, commandId: string, value: unknown, kind: ReceiptContentKind = 'result'): Promise<SealedReceiptRef> {
    const contentId = randomUUID();
    const bytes = Buffer.from(JSON.stringify(value ?? null));
    try {
      return { format: 'rhiza.sealed-receipt.v1', contentId, reference: await this.content.put(this.identity(workspaceId, commandId, contentId, kind), bytes) };
    } finally { bytes.fill(0); }
  }
  async read<T>(workspaceId: string, commandId: string, reference: SealedReceiptRef, kind: ReceiptContentKind = 'result'): Promise<T> {
    if (reference.format !== 'rhiza.sealed-receipt.v1' || typeof reference.contentId !== 'string' || !reference.contentId || !reference.reference) throw new Error('RECEIPT_CONTENT_REFERENCE_INVALID');
    const bytes = await this.content.read(this.identity(workspaceId, commandId, reference.contentId, kind), reference.reference);
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T; }
    finally { bytes.fill(0); }
  }
  destroy(workspaceId: string, commandId: string, reference: SealedReceiptRef, kind: ReceiptContentKind = 'result') {
    return this.content.destroy(this.identity(workspaceId, commandId, reference.contentId, kind));
  }
}
