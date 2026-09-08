import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { NodeContentKeys } from './node-content-keys';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { NodeSealedContentStore, type SealedContentRef } from './node-sealed-content-store';

export interface SealedJournalRef { format: 'rhiza.sealed-journal.v1'; contentId: string; reference: SealedContentRef }

/** Only payload is encrypted; event identity and ordering remain SQL facts. */
export class SealedJournalContent {
  static atDirectory(root: string) {
    return new SealedJournalContent(new NodeSealedContentStore(new NodeFilesystemBlobStore(root), new NodeContentKeys(join(root, 'keys'))));
  }
  constructor(private readonly content: NodeSealedContentStore) {}
  /** Requires exclusive publication ownership and references from every workspace. */
  revokeUnreferencedKeys(references: Array<{ workspaceId: string; id: string; contentId: string }>) {
    return this.content.revokeUnreferencedKeys(references.map(item => this.identity(item.workspaceId, item.id, item.contentId)));
  }
  auditKeys(references: Array<{ workspaceId: string; id: string; contentId: string }>) {
    return this.content.auditKeys(references.map(item => this.identity(item.workspaceId, item.id, item.contentId)));
  }
  private identity(workspaceId: string, eventId: string, contentId: string) {
    if (!eventId || !contentId) throw new Error('JOURNAL_CONTENT_IDENTITY_REQUIRED');
    return { workspaceId, contentId: JSON.stringify(['journal-payload', eventId, contentId]) };
  }
  async seal(workspaceId: string, eventId: string, payload: Record<string, unknown>): Promise<SealedJournalRef> {
    const contentId = randomUUID();
    const bytes = Buffer.from(JSON.stringify(payload));
    try {
      return { format: 'rhiza.sealed-journal.v1', contentId, reference: await this.content.put(this.identity(workspaceId, eventId, contentId), bytes) };
    } finally { bytes.fill(0); }
  }
  async read(workspaceId: string, eventId: string, reference: SealedJournalRef): Promise<Record<string, unknown>> {
    if (reference.format !== 'rhiza.sealed-journal.v1' || typeof reference.contentId !== 'string' || !reference.contentId || !reference.reference) throw new Error('JOURNAL_CONTENT_REFERENCE_INVALID');
    const bytes = await this.content.read(this.identity(workspaceId, eventId, reference.contentId), reference.reference);
    try {
      const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('JOURNAL_PAYLOAD_INVALID');
      return payload;
    } finally { bytes.fill(0); }
  }
  destroy(workspaceId: string, eventId: string, reference: SealedJournalRef) {
    return this.content.destroy(this.identity(workspaceId, eventId, reference.contentId));
  }
}
