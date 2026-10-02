import { createHash } from 'node:crypto';
import type { ContextItem, WorkspaceData } from '../domain';

export const contextSourceDigest = (content: string) => createHash('sha256').update(content).digest('hex');
export const contextSourceRevision = (digest: string, resourceVersionId?: string, resourceDigest?: string) =>
  contextSourceDigest(JSON.stringify([digest, resourceVersionId ?? null, resourceDigest ?? null]));

/** Same source bytes for transactional decisions and the candidate projection. */
export function contextSourceSnapshot(workspace: WorkspaceData, sourceType: NonNullable<ContextItem['sourceType']>, sourceId: string) {
  let value: { title: string; content: string; nodeId?: string; attachmentId?: string } | undefined;
  if (sourceType === 'node') {
    const node = workspace.discussionNodes.find(item => item.id === sourceId && item.status !== 'archived');
    if (node) value = { title: node.title, nodeId: node.id, content: `${node.title}\n${node.summary}\n${workspace.messages.filter(item => item.nodeId === node.id).map(item => item.text).join('\n')}` };
  } else if (sourceType === 'segment') {
    const segment = workspace.segments.find(item => item.id === sourceId && item.status !== 'archived');
    if (segment && workspace.discussionNodes.some(node => node.id === segment.nodeId && node.status !== 'archived')) value = { title: segment.title, nodeId: segment.nodeId, content: workspace.anchors.find(anchor => anchor.segmentId === sourceId)?.selectedText || workspace.messages.filter(item => item.segmentId === sourceId).map(item => item.text).join('\n') || segment.title };
  } else if (sourceType === 'file') {
    const file = workspace.attachments.find(item => item.id === sourceId);
    if (file) value = { title: file.name, attachmentId: file.id, content: file.summary || file.name };
  } else if (sourceType === 'chunk') {
    const chunk = workspace.fileChunks.find(item => item.id === sourceId);
    const file = workspace.attachments.find(item => item.id === chunk?.attachmentId);
    if (chunk && file) value = { title: `${file.name} · chunk ${chunk.ordinal + 1}`, attachmentId: file.id, content: chunk.text };
  } else {
    const reference = workspace.contextItems.find(item => (item.sourceType ?? 'reference') === 'reference' && (item.sourceId ?? item.id) === sourceId);
    if (reference) value = { title: reference.title, content: reference.content || reference.detail };
  }
  if (!value) return undefined;
  const attachment = workspace.attachments.find(item => item.id === value.attachmentId);
  const digest = contextSourceDigest(value.content);
  return { ...value, digest, sourceRevision: contextSourceRevision(digest, attachment?.resourceVersionId, attachment?.digest) };
}

export function validateContextConfirmation(item: ContextItem, revision?: string) {
  if (['AI_RECOMMENDED_ACCEPTED', 'USER_SELECTED'].includes(item.selectionMode ?? '') && item.sourceRevision && item.sourceRevision !== revision) {
    throw Object.assign(new Error('来源已变化，请重新确认 Context 推荐。'), { code: 'CONTEXT_SELECTION_STALE', status: 409 });
  }
}
