import type { WorkspaceData } from '../domain';
import type { DomainEventEnvelope } from '../domain-journal';

/** Tx A records introduced snapshots even when a Run fails before Manifest commit. */
export function runFrozenResourceIds(workspace: WorkspaceData, nodeId: string, runs: Array<{ id: string; workspaceId: string; nodeId: string }>, journal: DomainEventEnvelope[]): string[] {
  const ownedRuns = new Set(runs.filter(run => run.workspaceId === workspace.projectId
    && (run.nodeId === nodeId || run.nodeId === `temp:${nodeId}`)).map(run => run.id));
  const live = new Set(workspace.resources.filter(resource => resource.kind === 'context-source'
    && workspace.resourceVersions.some(version => version.resourceId === resource.id && !version.purgedAt)).map(resource => resource.id));
  let prior = new Set<string>();
  const owned = new Set<string>();
  for (const event of journal) {
    const snapshot = event.payload.snapshot as { state?: { resources?: Array<{ id: string }> } } | undefined;
    const changes = event.payload.stateChanges as { resources?: Array<{ id: string }> } | undefined;
    const resources = snapshot?.state?.resources ?? changes?.resources;
    if (!resources) continue;
    const next = new Set(resources.map(resource => resource.id));
    if (event.workspaceId === workspace.projectId && event.eventType === 'run.created' && ownedRuns.has(event.aggregateId)) {
      for (const id of next) if (!prior.has(id) && live.has(id)) owned.add(id);
    }
    prior = next;
  }
  return [...owned].sort();
}

/** A Manifest owns its frozen snapshots, never the independent source versions. */
export function purgeResourceIds(workspace: WorkspaceData, nodeId: string, frozenResourceIds: readonly string[] = []): Set<string> {
  const attachmentIds = new Set(workspace.messages.filter(message => message.nodeId === nodeId).flatMap(message => message.attachmentIds ?? []));
  const resources = new Set(workspace.attachments.filter(attachment => attachmentIds.has(attachment.id))
    .flatMap(attachment => attachment.resourceId ? [attachment.resourceId] : []));
  for (const id of frozenResourceIds) resources.add(id);
  for (const manifest of workspace.manifests.filter(item => item.nodeId === nodeId)) {
    for (const item of manifest.contextItems) {
      if (item.resourceId && item.resourceVersionId
        && workspace.resources.some(resource => resource.id === item.resourceId && resource.kind === 'context-source')
        && workspace.resourceVersions.some(version => version.id === item.resourceVersionId && version.resourceId === item.resourceId)) resources.add(item.resourceId);
    }
  }
  return resources;
}
