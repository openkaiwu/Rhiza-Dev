import { randomUUID } from 'node:crypto';
import { NodeSealedContentStore, type SealedContentRef } from './node-sealed-content-store';

export interface SealedReceiptRef { format: 'rhiza.sealed-receipt.v1'; contentId: string; reference: SealedContentRef }

export class SealedReceiptContent {
  constructor(private readonly content: NodeSealedContentStore) {}
  private identity(workspaceId: string, commandId: string, contentId: string) {
    return { workspaceId, contentId: JSON.stringify(['command-receipt', commandId, contentId]) };
  }
  async seal(workspaceId: string, commandId: string, value: unknown): Promise<SealedReceiptRef> {
    const contentId = randomUUID();
    const bytes = Buffer.from(JSON.stringify(value ?? null));
    try {
      return { format: 'rhiza.sealed-receipt.v1', contentId, reference: await this.content.put(this.identity(workspaceId, commandId, contentId), bytes) };
    } finally { bytes.fill(0); }
  }
  async read<T>(workspaceId: string, commandId: string, reference: SealedReceiptRef): Promise<T> {
    if (reference.format !== 'rhiza.sealed-receipt.v1' || typeof reference.contentId !== 'string' || !reference.contentId || !reference.reference) throw new Error('RECEIPT_CONTENT_REFERENCE_INVALID');
    const bytes = await this.content.read(this.identity(workspaceId, commandId, reference.contentId), reference.reference);
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T; }
    finally { bytes.fill(0); }
  }
  destroy(workspaceId: string, commandId: string, reference: SealedReceiptRef) {
    return this.content.destroy(this.identity(workspaceId, commandId, reference.contentId));
  }
}
