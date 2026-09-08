import type { PortableWorkspaceFacts } from './ports/portable-workspace';
import type { StoredAttachment, StoredMessage, ContextManifest, WorkspaceData } from '../domain';

function select<T extends object>(value: T, keys: readonly (keyof T)[]): T {
  return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]])) as T;
}
const portableName = (name: string) => /^(?:\/|[a-z]:[\\/]|\\\\)/i.test(name) ? name.split(/[\\/]/).filter(Boolean).at(-1) ?? 'resource' : name;
const attachment = (value: StoredAttachment) => ({ ...select(value, ['id', 'name', 'mimeType', 'size', 'kind', 'extractedText', 'summary', 'chunkCount', 'resourceId', 'resourceVersionId', 'digest', 'blobRef', 'createdAt']), name: portableName(value.name) });
const message = (value: StoredMessage): StoredMessage => ({ ...select(value, ['id', 'nodeId', 'kind', 'text', 'createdAt', 'manifestId', 'attachmentIds', 'operation', 'sourceMessageId', 'versionGroupId', 'version', 'replyToMessageId', 'segmentId', 'reasoning']),
  ...(value.usage ? { usage: select(value.usage, ['promptTokens', 'completionTokens', 'totalTokens', 'estimated']) } : {}),
  ...(value.toolCalls ? { toolCalls: value.toolCalls.map(call => select(call, ['id', 'name', 'arguments'])) } : {}) });
const context = (value: WorkspaceData['contextItems'][number]) => select(value, ['id', 'title', 'detail', 'role', 'status', 'tokens', 'reason', 'selectionMode', 'sourceType', 'sourceId', 'sourceNodeId', 'pinned', 'contentVersion', 'content', 'score']);
function manifest(value: ContextManifest): ContextManifest {
  const result = select(value, ['schemaVersion', 'versions', 'id', 'projectId', 'nodeId', 'requestId', 'createdAt', 'mode', 'model', 'provider', 'runtime', 'contextItemIds', 'excludedItemIds', 'estimatedTokens', 'operation', 'sourceMessageId', 'attachmentIds']);
  result.generation = select(value.generation, ['temperature', 'topP', 'maxTokens']);
  result.contextItems = value.contextItems.map(item => select(item, ['sourceType', 'sourceId', 'sourceNodeId', 'title', 'detail', 'role', 'selectionMode', 'pinned', 'reason', 'tokenCount', 'contentVersion', 'resourceId', 'resourceVersionId', 'digest', 'priority', 'contributorVersion', 'originResourceVersionId', 'originDigest']));
  if (value.omissions) result.omissions = value.omissions.map(item => select(item, ['sourceType', 'sourceId', 'title', 'tokenCount', 'code', 'reason']));
  if (value.planner) result.planner = select(value.planner, ['candidateCount', 'selectedCount', 'elapsedMs', 'fallback', 'budget', 'usedTokens']);
  if (value.cache) result.cache = { ...select(value.cache, ['key', 'reason']), vector: stripOperationalMetadata(value.cache.vector) as Record<string, string> };
  if (value.versions) result.versions = { ...select(value.versions, ['planner', 'compiler', 'tokenizer', 'selectionPolicy']), contributors: stripOperationalMetadata(value.versions.contributors) as Record<string, string> };
  return result;
}

/** Operational metadata is excluded even when it appears in nested Journal snapshots. */
export function stripOperationalMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripOperationalMetadata);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(?:.*(?:secret|credential|password|oauth|apikey|authorization).*|originmetadata|annotations|metadata|endpoint|baseurl|headers|extraheaders|hostdescriptor|absolutepath|filepath|gitremote|username|__proto__|constructor|prototype)$/i.test(key.replaceAll('_', '').replaceAll('-', '')))
    .map(([key, item]) => [key, ['logicalName', 'name'].includes(key) && typeof item === 'string' ? portableName(item) : stripOperationalMetadata(item)]));
}

/** Export DTO construction is independent of DB serialization and never exports endpoint locations. */
export function portableWorkspaceFacts(source: PortableWorkspaceFacts, hash: (input: unknown) => string): PortableWorkspaceFacts {
  const value = source.workspace;
  const workspace: WorkspaceData = {
    ...select(value, ['projectId', 'projectTitle', 'nodeId', 'activeNodeId', 'mode', 'updatedAt']),
    contextItems: value.contextItems.map(context), messages: value.messages.map(message), attachments: value.attachments.map(attachment),
    resources: value.resources.map(item => ({ ...select(item, ['id', 'workspaceId', 'kind', 'logicalName', 'createdAt']), logicalName: portableName(item.logicalName) })),
    resourceVersions: value.resourceVersions.map(item => select(item, ['id', 'resourceId', 'version', 'digestAlgorithm', 'digest', 'canonicalization', 'mediaType', 'size', 'blobRef', 'createdAt'])),
    materializations: value.materializations.map(item => select(item, ['id', 'resourceVersionId', 'kind', 'generator', 'createdAt'])),
    fileChunks: value.fileChunks.map(item => select(item, ['id', 'attachmentId', 'ordinal', 'text', 'startOffset', 'endOffset', 'tokens', 'terms', 'embedding', 'resourceVersionId'])),
    discussionNodes: value.discussionNodes.map(item => select(item, ['id', 'title', 'summary', 'status', 'kind', 'sourceNodeId', 'sourceMessageId', 'anchorText', 'x', 'y', 'createdAt', 'updatedAt'])),
    discussionEdges: value.discussionEdges.map(item => select(item, ['id', 'source', 'target', 'relation', 'anchorId', 'label', 'createdAt'])),
    anchors: value.anchors.map(item => select(item, ['id', 'nodeId', 'messageId', 'segmentId', 'selectedText', 'startOffset', 'endOffset', 'createdAt'])),
    manifests: value.manifests.map(manifest), segments: value.segments.map(item => select(item, ['id', 'nodeId', 'ordinal', 'title', 'createdAt'])),
    auditEvents: value.auditEvents.map(item => ({ ...select(item, ['id', 'projectId', 'nodeId', 'action', 'entityType', 'entityId', 'createdAt']), metadata: {} })),
  };
  const runs = source.runs.map(run => {
    const original = run.input.request;
    const request = { ...select(original, ['requestId', 'manifestId', 'projectId', 'nodeId', 'modelId', 'prompt', 'mode', 'operation', 'sourceMessageId']),
      history: original.history.map(message), contextItems: original.contextItems.map(context),
      ...(original.attachments ? { attachments: original.attachments.map(attachment) } : {}),
      ...(original.generation ? { generation: select(original.generation, ['temperature', 'topP', 'maxTokens']) } : {}),
      ...(original.modelSnapshot ? { modelSnapshot: select(original.modelSnapshot, ['id', 'provider', 'model', 'displayName', 'active', 'providerEndpointRef', 'endpointVersion']) } : {}) };
    const input = { schemaVersion: run.input.schemaVersion, request, executor: select(run.input.executor, ['runtime', 'modelSpecRef', 'providerEndpointRef', 'model', 'provider']),
      ...(run.input.replay ? { replay: select(run.input.replay, ['classification', 'sourceRunRef', 'sourceManifestRef']) } : {}) };
    return { ...select(run, ['id', 'workspaceId', 'nodeId', 'commandId', 'status', 'attempt', 'parentRunRef', 'createdAt', 'dispatchingAt', 'runningAt', 'terminalAt', 'cancelRequestedAt']),
      input, inputHash: hash(input), originInputHash: run.originInputHash ?? run.inputHash,
      telemetry: { traceCount: 0, ...(run.telemetry.usage ? { usage: select(run.telemetry.usage, ['promptTokens', 'completionTokens', 'totalTokens', 'estimated']) } : {}) },
      ...(run.error ? { error: { ...select(run.error, ['code', 'class']), message: 'Historical execution failure' } } : {}) };
  });
  return structuredClone({ workspace, runs,
    directory: select(source.directory, ['workspaceId', 'name', 'status', 'createdBy', 'revision']),
    members: source.members.map(member => select(member, ['userId', 'role'])),
    provenance: source.provenance.map(link => select(link, ['schemaVersion', 'id', 'workspaceId', 'outputRef', 'inputRefs', 'contextManifestRef', 'runRef', 'parentRevisionRef', 'branchSourceRef', 'modelSpecRef', 'providerEndpointRef', 'runtimeSnapshotRef', 'status', 'missingRefs', 'createdAt'])),
    journal: source.journal.map(event => ({ ...select(event, ['eventId', 'workspaceId', 'sequence', 'eventType', 'ceSpecversion', 'envelopeVersion', 'eventSource', 'subject', 'dataSchema', 'aggregateType', 'aggregateId', 'aggregateRevision', 'commandId', 'eventIndex', 'causationId', 'correlationId', 'occurredAt', 'recordedAt']),
      actor: select(event.actor, ['actorType', 'actorId']), scope: select(event.scope, ['scopeType', 'scopeId']), payload: stripOperationalMetadata(event.payload) as typeof event.payload })),
  });
}
