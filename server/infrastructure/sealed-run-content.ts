import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { NodeContentKeys } from './node-content-keys';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { NodeSealedContentStore, type SealedContentRef } from './node-sealed-content-store';
import { semanticStateChecksum } from './workspace-semantic-checksum';

export interface SealedRunInputRef { format: 'rhiza.sealed-run-input.v1'; contentId: string; reference: SealedContentRef }
const inputHash = (input: object) => semanticStateChecksum(input as Record<string, unknown>);

/** Run input identity is separate from command receipts, including for the same command. */
export class SealedRunContent {
  static atDirectory(root: string) {
    return new SealedRunContent(new NodeSealedContentStore(new NodeFilesystemBlobStore(root), new NodeContentKeys(join(root, 'keys'))));
  }
  constructor(private readonly content: NodeSealedContentStore) {}
  private identity(workspaceId: string, runId: string, contentId: string) {
    if (!runId || !contentId) throw new Error('RUN_CONTENT_IDENTITY_REQUIRED');
    return { workspaceId, contentId: JSON.stringify(['execution-run-input', runId, contentId]) };
  }
  async seal(workspaceId: string, runId: string, input: object, expectedHash: string): Promise<SealedRunInputRef> {
    if (inputHash(input) !== expectedHash) throw new Error('RUN_INPUT_HASH_MISMATCH');
    const contentId = randomUUID();
    const bytes = Buffer.from(JSON.stringify(input));
    try {
      return { format: 'rhiza.sealed-run-input.v1', contentId, reference: await this.content.put(this.identity(workspaceId, runId, contentId), bytes) };
    } finally { bytes.fill(0); }
  }
  async read<T extends object>(workspaceId: string, runId: string, reference: SealedRunInputRef, expectedHash: string): Promise<T> {
    if (reference.format !== 'rhiza.sealed-run-input.v1' || typeof reference.contentId !== 'string' || !reference.contentId || !reference.reference) throw new Error('RUN_CONTENT_REFERENCE_INVALID');
    const bytes = await this.content.read(this.identity(workspaceId, runId, reference.contentId), reference.reference);
    try {
      const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
      if (inputHash(input) !== expectedHash) throw new Error('RUN_INPUT_HASH_MISMATCH');
      return input;
    } finally { bytes.fill(0); }
  }
  destroy(workspaceId: string, runId: string, reference: SealedRunInputRef) {
    return this.content.destroy(this.identity(workspaceId, runId, reference.contentId));
  }
}
