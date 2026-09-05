import type { ContextItem } from '../domain';
import type { ContextCompiler, FrozenContextItem } from '../context-runtime/contracts';
import type { BlobStorePort } from '../application/ports/host-runtime';

/** JSON preserves empty strings and exact Unicode while retaining the raw-v1 Blob contract. */
export class BlobContextCompiler implements ContextCompiler {
  readonly version = 'frozen-resource-v1';
  constructor(private readonly blobs: BlobStorePort, private readonly id: () => string, private readonly now: () => string) {}

  async compile(workspaceId: string, items: readonly ContextItem[]): Promise<FrozenContextItem[]> {
    return Promise.all(items.map(async (source, priority) => {
      const item = structuredClone(source);
      if (item.content === undefined) throw Object.assign(new Error('Context source has no resolved content'), { code: 'CONTEXT_SOURCE_UNRESOLVED', status: 409 });
      const bytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: '1.0.0', content: item.content }));
      const blob = await this.blobs.put(bytes);
      const verified = await this.blobs.read(blob.blobRef, blob.digest);
      if (verified.length !== bytes.length || verified.some((byte, index) => byte !== bytes[index])) throw Object.assign(new Error('Frozen context verification failed'), { code: 'BLOB_INTEGRITY_ERROR', status: 409 });
      const createdAt = this.now();
      const resource = { id: this.id(), workspaceId, kind: 'context-source' as const, logicalName: (item.title || item.sourceId || item.id).slice(0, 240), createdAt };
      return { item: structuredClone(item), resource, resourceVersion: { id: this.id(), resourceId: resource.id, version: 1, ...blob, canonicalization: 'raw-v1' as const, mediaType: 'application/vnd.rhiza.context+json', createdAt }, priority, contributorVersion: 'lexical-v1' };
    }));
  }
}
