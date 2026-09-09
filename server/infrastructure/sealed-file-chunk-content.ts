import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { FileChunk } from '../domain';
import { NodeContentKeys } from './node-content-keys';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { NodeSealedContentStore, type SealedContentRef } from './node-sealed-content-store';

type FileChunkContent = Pick<FileChunk, 'text' | 'terms' | 'embedding'>;
export interface SealedFileChunkRef { format: 'rhiza.sealed-file-chunk.v1'; contentId: string; reference: SealedContentRef }

/** Explicit storage projection: never spread caller-owned fields into plaintext JSON. */
export function fileChunkStorageProjection(item: FileChunk, contentRef: SealedFileChunkRef) {
  return {
    id: item.id, attachmentId: item.attachmentId, ordinal: item.ordinal,
    startOffset: item.startOffset, endOffset: item.endOffset, tokens: item.tokens,
    resourceVersionId: item.resourceVersionId, text: '', terms: [], embedding: [], contentRef,
  };
}

export class SealedFileChunkContent {
  static atDirectory(root: string) {
    return new SealedFileChunkContent(new NodeSealedContentStore(new NodeFilesystemBlobStore(root), new NodeContentKeys(join(root, 'keys'))));
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
    if (!itemId || !contentId) throw new Error('FILE_CHUNK_CONTENT_IDENTITY_REQUIRED');
    return { workspaceId, contentId: JSON.stringify(['file-chunk-content', itemId, contentId]) };
  }
  async seal(workspaceId: string, itemId: string, item: FileChunkContent): Promise<SealedFileChunkRef> {
    const contentId = randomUUID();
    const bytes = Buffer.from(JSON.stringify({ text: item.text, terms: item.terms, embedding: item.embedding }));
    try {
      return { format: 'rhiza.sealed-file-chunk.v1', contentId, reference: await this.content.put(this.identity(workspaceId, itemId, contentId), bytes) };
    } finally { bytes.fill(0); }
  }
  async read(workspaceId: string, itemId: string, reference: SealedFileChunkRef): Promise<FileChunkContent> {
    if (reference.format !== 'rhiza.sealed-file-chunk.v1' || typeof reference.contentId !== 'string' || !reference.contentId || !reference.reference) throw new Error('FILE_CHUNK_CONTENT_REFERENCE_INVALID');
    const bytes = await this.content.read(this.identity(workspaceId, itemId, reference.contentId), reference.reference);
    try {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || typeof value.text !== 'string'
        || !Array.isArray(value.terms) || !value.terms.every((term: unknown) => typeof term === 'string')
        || !Array.isArray(value.embedding) || !value.embedding.every((entry: unknown) => typeof entry === 'number' && Number.isFinite(entry))
        || Object.keys(value).some(key => !['text', 'terms', 'embedding'].includes(key))) throw new Error('FILE_CHUNK_CONTENT_INVALID');
      return value;
    } finally { bytes.fill(0); }
  }
  destroy(workspaceId: string, itemId: string, reference: SealedFileChunkRef) {
    return this.content.destroy(this.identity(workspaceId, itemId, reference.contentId));
  }
}
