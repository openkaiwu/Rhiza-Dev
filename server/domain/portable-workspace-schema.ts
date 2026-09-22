// Portable format contract. Optional fields are explicit; unknown operational fields are rejected.
const text = { type: 'string' };
const id = { type: 'string', minLength: 1 };
const integer = { type: 'integer', minimum: 0 };
const number = { type: 'number' };
const boolean = { type: 'boolean' };
const date = { type: 'string', format: 'date-time' };
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const enumeration = (...values: string[]) => ({ enum: values });
const array = (items: object) => ({ type: 'array', items });
const object = (properties: Record<string, object>, optional: string[] = []) => ({ type: 'object', properties,
  required: Object.keys(properties).filter(key => !optional.includes(key)), additionalProperties: false });
const strings = array(id);
const mode = enumeration('Auto', 'Assisted', 'Strict');
const operation = enumeration('send', 'retry', 'regenerate', 'edit-resend');
const sourceType = enumeration('node', 'segment', 'file', 'chunk', 'reference');
const role = enumeration('Fact', 'Constraint', 'Decision', 'Reference');
const selectionMode = enumeration('CURRENT', 'USER_SELECTED', 'AI_RECOMMENDED_ACCEPTED', 'AUTO_RETRIEVED');
const dictionary = { type: 'object', additionalProperties: text };
const generation = object({ temperature: number, topP: number, maxTokens: integer });
const usage = object({ promptTokens: integer, completionTokens: integer, totalTokens: integer, estimated: boolean }, ['estimated']);
const message = object({ id, nodeId: id, kind: enumeration('user', 'assistant'), text, createdAt: date, manifestId: id,
  attachmentIds: strings, operation, sourceMessageId: id, versionGroupId: id, version: integer, replyToMessageId: id, segmentId: id,
  reasoning: text, usage, toolCalls: array(object({ id, name: text, arguments: text })) },
['manifestId', 'attachmentIds', 'operation', 'sourceMessageId', 'versionGroupId', 'version', 'replyToMessageId', 'segmentId', 'reasoning', 'usage', 'toolCalls']);
const attachment = object({ id, name: text, mimeType: text, size: integer, kind: enumeration('file', 'image'), extractedText: text,
  summary: text, chunkCount: integer, resourceId: id, resourceVersionId: id, digest, blobRef: id, createdAt: date },
['extractedText', 'summary', 'chunkCount', 'resourceId', 'resourceVersionId', 'digest', 'blobRef']);
const context = object({ id, title: text, detail: text, role, status: enumeration('active', 'recommended', 'excluded'), tokens: integer,
  reason: text, selectionMode, sourceType, sourceId: id, sourceNodeId: id, pinned: boolean, contentVersion: integer, content: text, score: number },
['reason', 'selectionMode', 'sourceType', 'sourceId', 'sourceNodeId', 'pinned', 'contentVersion', 'content', 'score']);
const manifest = object({ schemaVersion: { const: '1.0.0' }, id, projectId: id, nodeId: id, requestId: id, createdAt: date, mode,
  model: text, provider: text, runtime: enumeration('provider-adapter', 'librechat'), contextItemIds: strings, excludedItemIds: strings,
  contextItems: array(object({ sourceType, sourceId: id, sourceNodeId: id, title: text, detail: text, role, selectionMode, pinned: boolean,
    reason: text, tokenCount: integer, contentVersion: integer, resourceId: id, resourceVersionId: id, digest, priority: number,
    contributorVersion: text, originResourceVersionId: id, originDigest: digest },
  ['sourceNodeId', 'resourceId', 'resourceVersionId', 'digest', 'priority', 'contributorVersion', 'originResourceVersionId', 'originDigest'])),
  estimatedTokens: integer, generation, operation, sourceMessageId: id, attachmentIds: strings,
  omissions: array(object({ sourceType, sourceId: id, title: text, tokenCount: integer, code: enumeration('excluded', 'strict', 'low_score', 'budget', 'chunk_limit'), reason: text })),
  cache: object({ key: text, reason: text, vector: dictionary }),
  versions: object({ planner: text, compiler: text, contributors: dictionary, tokenizer: text, selectionPolicy: text }),
  planner: object({ candidateCount: integer, selectedCount: integer, elapsedMs: number, fallback: boolean, budget: integer, usedTokens: integer }) },
['schemaVersion', 'sourceMessageId', 'omissions', 'cache', 'versions', 'planner']);
const workspace = object({ projectId: id, projectTitle: text, nodeId: id, activeNodeId: id, mode, updatedAt: date,
  contextItems: array(context), messages: array(message), attachments: array(attachment), manifests: array(manifest),
  resources: array(object({ id, workspaceId: id, kind: enumeration('attachment', 'context-source'), logicalName: text, createdAt: date })),
  resourceVersions: array(object({ id, resourceId: id, version: { type: 'integer', minimum: 1 }, digestAlgorithm: { const: 'sha256' }, digest,
    canonicalization: { const: 'raw-v1' }, mediaType: text, size: integer, blobRef: id, createdAt: date })),
  materializations: array(object({ id, resourceVersionId: id, kind: { const: 'file-chunks' }, generator: { const: 'legacy-context-planner-v1' }, createdAt: date })),
  fileChunks: array(object({ id, attachmentId: id, ordinal: integer, text, startOffset: integer, endOffset: integer, tokens: integer,
    terms: array(text), embedding: array(number), resourceVersionId: id }, ['resourceVersionId'])),
  discussionNodes: array(object({ id, title: text, summary: text, status: enumeration('draft', 'active', 'resolved', 'stale', 'archived'),
    kind: enumeration('main', 'branch'), sourceNodeId: id, sourceMessageId: id, anchorText: text, x: number, y: number, createdAt: date, updatedAt: date },
  ['sourceNodeId', 'sourceMessageId', 'anchorText'])),
  discussionEdges: array(object({ id, source: id, target: id, relation: enumeration('derived-from', 'references', 'related-to', 'merged-into'), anchorId: id, label: text, createdAt: date }, ['anchorId'])),
  anchors: array(object({ id, nodeId: id, messageId: id, segmentId: id, selectedText: text, startOffset: integer, endOffset: integer, createdAt: date },
  ['messageId', 'segmentId', 'selectedText', 'startOffset', 'endOffset'])),
  segments: array(object({ id, nodeId: id, ordinal: integer, title: text, createdAt: date })),
  auditEvents: array(object({ id, projectId: id, nodeId: id, action: text, entityType: enumeration('project', 'node', 'segment', 'event', 'workspace'),
    entityId: id, metadata: object({}), createdAt: date }, ['nodeId'])) });
const request = object({ requestId: id, manifestId: id, projectId: id, nodeId: id, modelId: id, prompt: text, history: array(message),
  contextItems: array(context), mode, attachments: array(attachment), generation, operation, sourceMessageId: id,
  modelSnapshot: object({ id, provider: text, model: text, displayName: text, active: boolean, providerEndpointRef: id, endpointVersion: text }, ['providerEndpointRef', 'endpointVersion']) },
['attachments', 'generation', 'operation', 'sourceMessageId', 'modelSnapshot']);
const run = object({ id, workspaceId: id, nodeId: id, commandId: id, status: enumeration('completed', 'failed', 'canceled', 'interrupted'),
  attempt: { type: 'integer', minimum: 1 }, parentRunRef: id, inputHash: digest, originInputHash: digest,
  input: object({ schemaVersion: { const: '1.0.0' }, request, executor: object({ runtime: id, modelSpecRef: id, providerEndpointRef: id, model: text, provider: text }),
    replay: object({ classification: enumeration('exact', 'partial', 'current-model'), sourceRunRef: id, sourceManifestRef: id }) }, ['replay']),
  createdAt: date, dispatchingAt: date, runningAt: date, terminalAt: date, cancelRequestedAt: date,
  error: object({ code: text, class: enumeration('canceled', 'timeout', 'provider', 'network', 'interrupted', 'commit'), message: text }),
  telemetry: object({ traceCount: { const: 0 }, usage }, ['usage']) },
['parentRunRef', 'originInputHash', 'dispatchingAt', 'runningAt', 'terminalAt', 'cancelRequestedAt', 'error']);
const provenance = object({ schemaVersion: { const: '1.0.0' }, id, workspaceId: id, outputRef: id, inputRefs: strings,
  contextManifestRef: id, runRef: id, parentRevisionRef: id, branchSourceRef: id, modelSpecRef: id, providerEndpointRef: id, runtimeSnapshotRef: id,
  status: enumeration('recorded', 'pre-run', 'purged'), missingRefs: { type: 'array', maxItems: 0 }, createdAt: date },
['contextManifestRef', 'runRef', 'parentRevisionRef', 'branchSourceRef', 'modelSpecRef', 'providerEndpointRef', 'runtimeSnapshotRef']);

// Match workspaceSemanticSnapshot: omit aggregate timestamps and rename graph collections.
const semanticProperties = Object.fromEntries(Object.entries(workspace.properties)
  .filter(([key]) => !['nodeId', 'updatedAt', 'auditEvents'].includes(key))
  .map(([key, schema]) => {
    const copy = JSON.parse(JSON.stringify(schema)) as { items?: { properties: Record<string, object>; required: string[] } };
    if (copy.items && !['contextItems', 'fileChunks'].includes(key)) {
      delete copy.items.properties.createdAt;
      copy.items.required = copy.items.required.filter(field => field !== 'createdAt');
      if (key === 'discussionNodes') {
        delete copy.items.properties.updatedAt;
        copy.items.required = copy.items.required.filter(field => field !== 'updatedAt');
      }
    }
    return [key === 'discussionNodes' ? 'nodes' : key === 'discussionEdges' ? 'edges' : key, copy];
  }));
export const portableSemanticDeltaSchema = object(semanticProperties, Object.keys(semanticProperties));

export const portableWorkspaceSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://rhiza.dev/schemas/portable-workspace/v1',
  ...object({ schemaVersion: { const: '1.0.0' }, facts: object({ workspace,
    directory: object({ workspaceId: id, name: text, status: enumeration('active', 'archived'), createdBy: id, revision: integer }),
    members: array(object({ userId: id, role: enumeration('owner', 'member') })), runs: array(run), provenance: array(provenance),
    journal: array({ $ref: 'https://rhiza.dev/schemas/domain-event-envelope/v1' }) }),
  runtimeSnapshots: array(object({ id, runRef: id, digest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' } })),
  providerEndpoints: array(object({ id, runRef: id, providerType: text, configurationVersion: { type: ['string', 'null'] }, credential_ref: { type: 'null' }, credential_required: { const: true } })),
  modelSpecs: array(object({ id, runRef: id, model: text, provider: text })) }),
};
