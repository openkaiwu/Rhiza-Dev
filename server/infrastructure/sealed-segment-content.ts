import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Segment } from '../domain';
import { NodeContentKeys } from './node-content-keys';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { NodeSealedContentStore, type SealedContentRef } from './node-sealed-content-store';

type SegmentContent = Pick<Segment, 'title'>;
export interface SealedSegmentRef { format: 'rhiza.sealed-segment.v1'; contentId: string; reference: SealedContentRef }

export class SealedSegmentContent {
  static atDirectory(root: string) {
    return new SealedSegmentContent(new NodeSealedContentStore(new NodeFilesystemBlobStore(root), new NodeContentKeys(join(root, 'keys'))));
  }
  constructor(private readonly content: NodeSealedContentStore) {}
  auditKeys(references: Array<{ workspaceId: string; id: string; contentId: string }>) {
    return this.content.auditKeys(references.map(item => this.identity(item.workspaceId, item.id, item.contentId)));
  }
  /** Requires exclusive publication ownership and every workspace's references. */
  revokeUnreferencedKeys(references: Array<{ workspaceId: string; id: string; contentId: string }>) {
    return this.content.revokeUnreferencedKeys(references.map(item => this.identity(item.workspaceId, item.id, item.contentId)));
  }
  private identity(workspaceId: string, segmentId: string, contentId: string) {
    if (!segmentId || !contentId) throw new Error('SEGMENT_CONTENT_IDENTITY_REQUIRED');
    return { workspaceId, contentId: JSON.stringify(['segment-content', segmentId, contentId]) };
  }
  async seal(workspaceId: string, segmentId: string, segment: SegmentContent): Promise<SealedSegmentRef> {
    const contentId = randomUUID();
    const bytes = Buffer.from(JSON.stringify({ title: segment.title }));
    try {
      return { format: 'rhiza.sealed-segment.v1', contentId, reference: await this.content.put(this.identity(workspaceId, segmentId, contentId), bytes) };
    } finally { bytes.fill(0); }
  }
  async read(workspaceId: string, segmentId: string, reference: SealedSegmentRef): Promise<SegmentContent> {
    if (reference.format !== 'rhiza.sealed-segment.v1' || typeof reference.contentId !== 'string' || !reference.contentId || !reference.reference) throw new Error('SEGMENT_CONTENT_REFERENCE_INVALID');
    const bytes = await this.content.read(this.identity(workspaceId, segmentId, reference.contentId), reference.reference);
    try {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || typeof value.title !== 'string'
        || Object.keys(value).some(key => key !== 'title')) throw new Error('SEGMENT_CONTENT_INVALID');
      return value;
    } finally { bytes.fill(0); }
  }
  destroy(workspaceId: string, segmentId: string, reference: SealedSegmentRef) {
    return this.content.destroy(this.identity(workspaceId, segmentId, reference.contentId));
  }
}
