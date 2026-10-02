import type { WorkspaceData } from '../domain';
import { graphBatchChildId, type GraphBatchItem, type GraphBatchPlannedItem, type GraphBatchRequest, type GraphBatchPlan } from '../contracts/graph-batch';

export const graphBatchError = (code: string, status = 409) => Object.assign(new Error(code), { code, status });
const only = (value: unknown, keys: string[]): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)));
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200
  && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const itemId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
export function validateGraphBatchRequest(value: unknown): GraphBatchRequest {
  function invalid(): never { throw graphBatchError('INVALID_GRAPH_BATCH', 400); }
  if (!only(value, ['kind', 'items', 'batchId', 'itemIds'])) invalid();
  if (value.kind === 'undo') {
    if (!only(value, ['kind', 'batchId', 'itemIds']) || !id(value.batchId)) invalid();
    if (value.itemIds !== undefined && (!Array.isArray(value.itemIds) || !value.itemIds.length || value.itemIds.length > 100
      || value.itemIds.some(entry => !itemId(entry)) || new Set(value.itemIds).size !== value.itemIds.length)) invalid();
    return JSON.parse(JSON.stringify(value)) as GraphBatchRequest;
  }
  if (value.kind !== 'apply' || !only(value, ['kind', 'items']) || !Array.isArray(value.items) || !value.items.length || value.items.length > 100) invalid();
  const seen = new Set<string>();
  for (const entry of value.items) {
    if (!only(entry, ['itemId', 'commandType', 'payload']) || !itemId(entry.itemId) || seen.has(entry.itemId)) invalid();
    seen.add(entry.itemId);
    if (entry.commandType === 'ArchiveObject') {
      if (!only(entry.payload, ['nodeId']) || !id(entry.payload.nodeId)) invalid();
    } else if (entry.commandType === 'CreateRelation') {
      if (!only(entry.payload, ['source', 'target', 'relation', 'label']) || !id(entry.payload.source) || !id(entry.payload.target)
        || entry.payload.source === entry.payload.target || !['derived-from', 'references', 'related-to', 'merged-into'].includes(String(entry.payload.relation))
        || (entry.payload.label !== undefined && (typeof entry.payload.label !== 'string' || entry.payload.label.length > 120))) invalid();
    } else invalid();
  }
  return JSON.parse(JSON.stringify(value)) as GraphBatchRequest;
}
const version = (node: WorkspaceData['discussionNodes'][number]) => ({ status: node.status, updatedAt: node.updatedAt });

/** The adapter invokes this pure preparation against its locked authoritative aggregate. */
export function prepareForwardGraphBatch(batchId: string, items: GraphBatchItem[], workspace: WorkspaceData): GraphBatchPlannedItem[] {
  const nodes = new Map(workspace.discussionNodes.map(node => [node.id, node]));
  return items.map(item => {
    const commandId = graphBatchChildId(batchId, item.itemId, 0);
    if (item.commandType === 'ArchiveObject') {
      const node = nodes.get(item.payload.nodeId);
      if (!node) return { itemId: item.itemId, steps: [], error: { code: 'NODE_NOT_FOUND', status: 404 } };
      if (node.status === 'archived') return { itemId: item.itemId, steps: [], skipped: 'ALREADY_ARCHIVED' };
      return { itemId: item.itemId, previousStatus: node.status, steps: [{ commandId, commandType: 'ArchiveObject', payload: { ...item.payload, expectedNodeVersion: version(node) } }] };
    }
    const source = nodes.get(item.payload.source), target = nodes.get(item.payload.target);
    if (!source || !target) return { itemId: item.itemId, steps: [], error: { code: 'NODE_NOT_FOUND', status: 404 } };
    return { itemId: item.itemId, steps: [{ commandId, commandType: 'CreateRelation', payload: { ...item.payload,
      expectedNodeVersions: [source, target].map(node => ({ nodeId: node.id, ...version(node) })) } }] };
  });
}

export function prepareUndoGraphBatch(batchId: string, original: GraphBatchPlan, itemIds: string[] | undefined,
  committed: Map<string, WorkspaceData | null>): GraphBatchPlannedItem[] {
  if (original.request.kind !== 'apply' || (itemIds && itemIds.some(id => !original.items.some(item => item.itemId === id)))) throw graphBatchError('INVALID_GRAPH_BATCH', 400);
  return original.items.filter(item => !itemIds || itemIds.includes(item.itemId)).map(item => {
    const after = committed.get(item.itemId);
    if (!after || item.error || item.skipped) return { itemId: item.itemId, steps: [], skipped: 'NOT_COMMITTED' };
    const forward = item.steps[0], commandId = graphBatchChildId(batchId, item.itemId, 0);
    if (forward.commandType === 'ArchiveObject') {
      const node = after.discussionNodes.find(node => node.id === forward.payload.nodeId);
      if (!node || node.status !== 'archived' || !item.previousStatus) throw graphBatchError('GRAPH_BATCH_RECEIPT_INVALID', 503);
      const result: GraphBatchPlannedItem = { itemId: item.itemId, steps: [{ commandId, commandType: 'ChangeNodeStatus',
        payload: { nodeId: node.id, status: 'active', expectedNodeVersion: version(node) } }] };
      if (item.previousStatus !== 'active') result.steps.push({ commandId: graphBatchChildId(batchId, item.itemId, 1), afterPrevious: true,
        commandType: 'ChangeNodeStatus', payload: { nodeId: node.id, status: item.previousStatus } });
      return result;
    }
    if (forward.commandType !== 'CreateRelation') throw graphBatchError('GRAPH_BATCH_RECEIPT_INVALID', 503);
    const edge = after.discussionEdges.find(edge => edge.source === forward.payload.source && edge.target === forward.payload.target && edge.relation === forward.payload.relation);
    if (!edge) throw graphBatchError('GRAPH_BATCH_RECEIPT_INVALID', 503);
    return { itemId: item.itemId, steps: [{ commandId, commandType: 'RemoveRelation', payload: { edgeId: edge.id, expectedRelation: structuredClone(edge) } }] };
  });
}
