import type { PortableWorkspaceFacts } from './ports/portable-workspace';
import type { CollaborationRecord } from '../contracts/collaboration';
import { collaborationHashInput } from './collaboration-policy';
import { bundleError } from '../domain/portable-bundle';

/** Portable collaboration facts are reconciled against the same Workspace's immutable history. */
export function validatePortableCollaborations(facts: PortableWorkspaceFacts, hash: (input: Record<string, unknown>) => string) {
  const nodes = new Set(facts.workspace.discussionNodes.map(node => node.id));
  const runs = new Map(facts.runs.map(run => [run.id, run]));
  const messages = new Map(facts.workspace.messages.map(message => [message.id, message]));
  const versions = new Map(facts.workspace.resourceVersions.map(version => [version.id, version]));
  const bad = () => { throw bundleError('BUNDLE_BROKEN_COLLABORATION'); };
  for (const event of facts.journal) {
    if (!event.payload.collaboration) continue;
    const record = event.payload.collaboration as CollaborationRecord;
    if (event.eventType !== 'collaboration.changed' || event.aggregateId !== record.id || record.workspaceId !== facts.workspace.projectId
      || !nodes.has(record.nodeId) || !nodes.has(record.base.nodeId) || record.base.workspaceId !== record.workspaceId
      || record.models?.some(model => ![...record.participants,record.synthesisModelId].includes(model.id))
      || [...record.participants, record.synthesisModelId].some(id => !record.models?.some(model => model.id === id))) bad();
    const bases = [record.base, ...record.attempts.map(attempt => attempt.input.base)];
    for (const base of bases) {
      if (base.contextBaseHash !== record.base.contextBaseHash || hash(collaborationHashInput(base) as unknown as Record<string, unknown>) !== base.contextBaseHash) bad();
      for (const message of base.history) {
        const current = messages.get(message.id);
        if (!current || current.nodeId !== message.nodeId || current.text !== message.text) bad();
      }
      for (const attachment of base.attachments ?? []) {
        const version = versions.get(attachment.resourceVersionId ?? '');
        if (!version || version.purgedAt || version.digest !== attachment.digest || version.resourceId !== attachment.resourceId) bad();
      }
      for (const item of base.manifest?.contextItems ?? []) {
        const version = versions.get(item.resourceVersionId ?? '');
        if (!version || version.purgedAt || version.digest !== item.digest) bad();
      }
    }
    for (const attempt of record.attempts) {
      const run = runs.get(attempt.runRef);
      if (!run || run.nodeId !== record.nodeId || run.input.request.manifestId !== attempt.manifestRef || run.input.executor.providerEndpointRef !== attempt.providerEndpointRef) bad();
      if (attempt.status === 'completed') {
        const output = messages.get(attempt.outputRef ?? '');
        if (!output || output.nodeId !== record.nodeId || output.manifestId !== attempt.manifestRef || output.text !== attempt.text) bad();
      }
      for (const output of attempt.input.exchange) {
        if (!record.attempts.some(source => source.runRef === output.runRef && source.manifestRef === output.manifestRef && source.outputRef === output.outputRef && source.text === output.text && source.status === output.status)) bad();
      }
    }
  }
}
