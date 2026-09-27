import type { PortableWorkspaceFacts } from './ports/portable-workspace';
import { bundleError } from '../domain/portable-bundle';

/** Resolve logical identities before an importer may activate any data. */
export function validatePortableReferences(facts: PortableWorkspaceFacts): void {
  const { workspace, runs, provenance, journal, directory, members } = facts;
  const missing: string[] = [];
  const ids = (values: { id: string }[], kind: string) => {
    const result = new Set<string>();
    for (const value of values) {
      if (!value.id || result.has(value.id)) throw bundleError(`BUNDLE_DUPLICATE_${kind.toUpperCase()}`);
      result.add(value.id);
    }
    return result;
  };
  const nodes = ids(workspace.discussionNodes, 'node'), messages = ids(workspace.messages, 'message');
  const manifests = ids(workspace.manifests, 'manifest'), resources = ids(workspace.resources, 'resource');
  const versions = ids(workspace.resourceVersions, 'version'), attachments = ids(workspace.attachments, 'attachment');
  const segments = ids(workspace.segments, 'segment'), anchors = ids(workspace.anchors, 'anchor'), runIds = ids(runs, 'run');
  const versionById = new Map(workspace.resourceVersions.map(version => [version.id, version]));
  const purgedVersions = new Set(workspace.resourceVersions.filter(version => version.purgedAt).map(version => version.id));
  const purgedResources = new Set(workspace.resourceVersions.filter(version => version.purgedAt).map(version => version.resourceId));
  const runById = new Map(runs.map(run => [run.id, run]));
  const messageById = new Map(workspace.messages.map(message => [message.id, message]));
  const manifestById = new Map(workspace.manifests.map(manifest => [manifest.id, manifest]));
  ids(workspace.discussionEdges, 'edge'); ids(provenance, 'provenance'); ids(workspace.materializations, 'materialization'); ids(workspace.fileChunks, 'chunk');
  const ref = (set: Set<string>, value: string | undefined, owner: string) => { if (value !== undefined && !set.has(value)) missing.push(`${owner}:${value}`); };
  const scope = (id: string, owner: string) => { if (id !== workspace.projectId) missing.push(`${owner}:workspace:${id}`); };
  scope(directory.workspaceId, 'directory');
  if (!members.some(member => member.userId === directory.createdBy && member.role === 'owner')) missing.push('directory:owner');
  if (new Set(members.map(member => member.userId)).size !== members.length) throw bundleError('BUNDLE_DUPLICATE_MEMBER');
  ref(nodes, workspace.activeNodeId, 'active-node');
  for (const node of workspace.discussionNodes) { ref(nodes, node.sourceNodeId, node.id); ref(messages, node.sourceMessageId, node.id); }
  for (const message of workspace.messages) {
    ref(nodes, message.nodeId, message.id); ref(manifests, message.manifestId, message.id); ref(messages, message.sourceMessageId, message.id);
    ref(messages, message.replyToMessageId, message.id); ref(segments, message.segmentId, message.id);
    for (const id of message.attachmentIds ?? []) ref(attachments, id, message.id);
  }
  for (const segment of workspace.segments) ref(nodes, segment.nodeId, segment.id);
  for (const anchor of workspace.anchors) { ref(nodes, anchor.nodeId, anchor.id); ref(messages, anchor.messageId, anchor.id); ref(segments, anchor.segmentId, anchor.id); }
  for (const edge of workspace.discussionEdges) { ref(nodes, edge.source, edge.id); ref(nodes, edge.target, edge.id); ref(anchors, edge.anchorId, edge.id); }
  for (const resource of workspace.resources) scope(resource.workspaceId, resource.id);
  for (const version of workspace.resourceVersions) {
    ref(resources, version.resourceId, version.id);
    if (version.purgedAt ? version.blobRef !== 'purged-v1'
      : version.blobRef !== `sha256/${version.digest.slice(0, 2)}/${version.digest}`) missing.push(`${version.id}:blob-identity`);
  }
  for (const attachment of workspace.attachments) {
    if (!attachment.resourceId || !attachment.resourceVersionId || !attachment.digest) missing.push(`${attachment.id}:unversioned-attachment`);
    ref(resources, attachment.resourceId, attachment.id); ref(versions, attachment.resourceVersionId, attachment.id);
    const version = versionById.get(attachment.resourceVersionId ?? '');
    if (version && (version.purgedAt || version.resourceId !== attachment.resourceId || version.digest !== attachment.digest || version.blobRef !== attachment.blobRef)) missing.push(`${attachment.id}:version-mismatch`);
  }
  for (const materialization of workspace.materializations) ref(versions, materialization.resourceVersionId, materialization.id);
  for (const chunk of workspace.fileChunks) {
    ref(attachments, chunk.attachmentId, chunk.id); ref(versions, chunk.resourceVersionId, chunk.id);
    if (chunk.resourceVersionId && purgedVersions.has(chunk.resourceVersionId)) missing.push(`${chunk.id}:purged-version`);
  }
  for (const item of workspace.contextItems) if (item.sourceId && (purgedVersions.has(item.sourceId) || purgedResources.has(item.sourceId))) missing.push(`${item.id}:purged-source`);
  for (const manifest of workspace.manifests) {
    scope(manifest.projectId, manifest.id); ref(nodes, manifest.nodeId, manifest.id);
    if (manifest.schemaVersion === '1.0.0') ref(runIds, manifest.requestId, manifest.id);
    for (const attachmentId of manifest.attachmentIds) ref(attachments, attachmentId, manifest.id);
    for (const item of manifest.contextItems) {
      ref(resources, item.resourceId, manifest.id); ref(versions, item.resourceVersionId, manifest.id); ref(versions, item.originResourceVersionId, manifest.id);
      if ((item.resourceVersionId && purgedVersions.has(item.resourceVersionId)) || (item.originResourceVersionId && purgedVersions.has(item.originResourceVersionId))) missing.push(`${manifest.id}:purged-version:${item.sourceId}`);
      const version = versionById.get(item.resourceVersionId ?? '');
      if (manifest.schemaVersion === '1.0.0' && (!version || version.resourceId !== item.resourceId || version.digest !== item.digest)) missing.push(`${manifest.id}:frozen-version:${item.sourceId}`);
    }
  }
  for (const run of runs) {
    scope(run.workspaceId, run.id); scope(run.input.request.projectId, run.id); ref(runIds, run.parentRunRef, run.id);
    if (['created', 'dispatching', 'running'].includes(run.status)) throw bundleError('BUNDLE_ACTIVE_EXECUTION');
    if (!run.nodeId.startsWith('temp:')) ref(nodes, run.nodeId, run.id);
    if (run.status === 'completed' && !run.nodeId.startsWith('temp:')) ref(manifests, run.input.request.manifestId, run.id);
    if (run.input.request.requestId !== run.id || !run.input.executor.modelSpecRef || !run.input.executor.providerEndpointRef) missing.push(`${run.id}:runtime-snapshot`);
    for (const attachment of run.input.request.attachments ?? []) if (attachment.resourceVersionId && purgedVersions.has(attachment.resourceVersionId)) missing.push(`${run.id}:purged-attachment`);
  }
  const outputs = new Set(provenance.map(link => link.outputRef));
  if (outputs.size !== provenance.length) throw bundleError('BUNDLE_DUPLICATE_OUTPUT_PROVENANCE');
  for (const message of workspace.messages.filter(message => message.kind === 'assistant')) ref(outputs, message.id, 'output-provenance');
  for (const link of provenance) {
    scope(link.workspaceId, link.id);
    if (link.status === 'purged') {
      if (link.missingRefs.length) missing.push(`${link.id}:purged-missing-refs`);
      continue;
    }
    ref(messages, link.outputRef, link.id); ref(runIds, link.runRef, link.id); ref(manifests, link.contextManifestRef, link.id);
    const run = runById.get(link.runRef ?? '');
    const output = messageById.get(link.outputRef);
    const manifest = manifestById.get(link.contextManifestRef ?? '');
    const frozenInputs = new Set(run?.input.request.history.map(message => message.id) ?? []);
    for (const input of link.inputRefs) if (!messages.has(input) && !frozenInputs.has(input)) missing.push(`${link.id}:${input}`);
    ref(messages, link.parentRevisionRef, link.id); ref(messages, link.branchSourceRef, link.id);
    if (!output || output.kind !== 'assistant' || output.manifestId !== link.contextManifestRef
      || output.sourceMessageId !== link.parentRevisionRef
      || (manifest && manifest.nodeId !== output.nodeId)
      || (run && (run.nodeId !== output.nodeId || manifest?.requestId !== run.id || run.input.request.manifestId !== manifest.id))
      || (link.status === 'recorded' && !run)) missing.push(`${link.id}:output-identity`);
    if (run && (link.modelSpecRef !== run.input.executor.modelSpecRef || link.providerEndpointRef !== run.input.executor.providerEndpointRef
      || link.runtimeSnapshotRef !== `run:${run.id}:input:${run.originInputHash ?? run.inputHash}`)) missing.push(`${link.id}:execution-identity`);
    if (link.status === 'broken-reference' || link.missingRefs.length) missing.push(`${link.id}:broken-reference`);
  }
  journal.forEach((event, index) => { scope(event.workspaceId, event.eventId); if (event.sequence !== index + 1) missing.push(`journal:sequence:${event.sequence}`); });
  if (!journal.length || !['workspace.created', 'workspace.baseline.backfilled'].includes(journal[0].eventType)) missing.push('journal:baseline');
  if (missing.length) throw Object.assign(bundleError('BUNDLE_BROKEN_REFERENCES'), { missingRefs: missing });
}
