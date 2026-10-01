import { isDeepStrictEqual } from 'node:util';
import type { WorkspaceData } from '../domain';

export function collectionChanges<T extends { id: string }>(next: T[], previous: T[] = []) {
  const before = new Map(previous.map(item => [item.id, item]));
  const after = new Map(next.map(item => [item.id, item]));
  if (after.size !== next.length) throw new Error('DUPLICATE_ENTITY_ID');
  return {
    inserted: next.filter(item => !before.has(item.id)),
    updated: next.filter(item => before.has(item.id) && !isDeepStrictEqual(before.get(item.id), item)),
    deleted: previous.filter(item => !after.has(item.id)),
  };
}

/** Check every relational reference before SQL can bind it to another Workspace. */
export function validateWorkspaceReferences(workspace: WorkspaceData, workspaceId: string, purgedNodeId?: string): void {
  const reject = () => { throw Object.assign(new Error('WORKSPACE_REFERENCE_MISMATCH'), { code: 'WORKSPACE_REFERENCE_MISMATCH', status: 409 }); };
  if (workspace.projectId !== workspaceId) reject();
  const nodes = new Set(workspace.discussionNodes.map(item => item.id));
  const messages = new Set(workspace.messages.map(item => item.id));
  const segments = new Map(workspace.segments.map(item => [item.id, item.nodeId]));
  const manifests = new Map(workspace.manifests.map(item => [item.id, item.nodeId]));
  const attachments = new Set(workspace.attachments.map(item => item.id));
  const resources = new Set(workspace.resources.map(item => item.id));
  const versions = new Map(workspace.resourceVersions.map(item => [item.id, item.resourceId]));
  const anchors = new Set(workspace.anchors.map(item => item.id));
  if (!nodes.has(workspace.activeNodeId)) reject();
  for (const node of workspace.discussionNodes) {
    if ((node.sourceNodeId && !nodes.has(node.sourceNodeId)) || (node.sourceMessageId && !messages.has(node.sourceMessageId))) reject();
  }
  for (const segment of workspace.segments) if (!nodes.has(segment.nodeId)) reject();
  for (const manifest of workspace.manifests) if (manifest.projectId !== workspaceId || !nodes.has(manifest.nodeId)) reject();
  for (const message of workspace.messages) {
    if (!nodes.has(message.nodeId) || (message.segmentId && segments.get(message.segmentId) !== message.nodeId)
      || (message.manifestId && manifests.get(message.manifestId) !== message.nodeId)
      || (message.sourceMessageId && !messages.has(message.sourceMessageId))
      || (message.replyToMessageId && !messages.has(message.replyToMessageId))
      || message.attachmentIds?.some(id => !attachments.has(id))) reject();
  }
  for (const resource of workspace.resources) if (resource.workspaceId !== workspaceId) reject();
  for (const version of workspace.resourceVersions) if (!resources.has(version.resourceId)) reject();
  for (const materialization of workspace.materializations) if (!versions.has(materialization.resourceVersionId)) reject();
  for (const attachment of workspace.attachments) {
    if ((attachment.resourceId && !resources.has(attachment.resourceId))
      || (attachment.resourceVersionId && versions.get(attachment.resourceVersionId) !== attachment.resourceId)) reject();
  }
  for (const anchor of workspace.anchors) if (!nodes.has(anchor.nodeId)
    || (anchor.messageId && !messages.has(anchor.messageId)) || (anchor.segmentId && !segments.has(anchor.segmentId))) reject();
  for (const edge of workspace.discussionEdges) if (!nodes.has(edge.source) || !nodes.has(edge.target) || (edge.anchorId && !anchors.has(edge.anchorId))) reject();
  for (const audit of workspace.auditEvents) if (audit.projectId !== workspaceId
    || (audit.nodeId && !nodes.has(audit.nodeId) && audit.nodeId !== purgedNodeId)) reject();
}
