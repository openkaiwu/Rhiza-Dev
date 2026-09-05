import type { WorkspaceData } from '../domain';
import type { ExecutionRun } from '../execution-runtime/run';
import type { DomainEventEnvelope } from '../domain-journal';
import { semanticStateChecksum } from '../infrastructure/workspace-semantic-checksum';
import type { GraphQueryResult, ObjectRef, ProjectedObject, ProjectedRelation, WorkspaceGraphProjection } from '../contracts/graph-projection';
export type { GraphQueryResult, ObjectRef, ProjectedObject, ProjectedRelation, WorkspaceGraphProjection } from '../contracts/graph-projection';

const legacyRelationCatalog: Record<string, string> = {
  'derived-from': 'derived_from',
  references: 'references',
  'related-to': 'related_to',
  'merged-into': 'merged_into',
};
const refKey = (ref: ObjectRef) => JSON.stringify([ref.workspaceId, ref.objectType, ref.objectId, ref.versionId ?? '']);
const ref = (workspaceId: string, objectType: string, objectId: string, versionId?: string): ObjectRef => ({ workspaceId, objectType, objectId, ...(versionId ? { versionId } : {}) });
const byRef = (left: ProjectedObject, right: ProjectedObject) => refKey(left.ref).localeCompare(refKey(right.ref));
const byRelation = (left: ProjectedRelation, right: ProjectedRelation) => left.id.localeCompare(right.id);

export function buildWorkspaceGraphProjection(workspace: WorkspaceData, runs: readonly ExecutionRun[] = [], checkpoint = 0, events: readonly Pick<DomainEventEnvelope, 'eventType' | 'sequence' | 'aggregateRevision' | 'occurredAt' | 'payload'>[] = []): WorkspaceGraphProjection {
  const removedObjects = new Map<string, { object: WorkspaceData['discussionNodes'][number]; event: Pick<DomainEventEnvelope, 'aggregateRevision' | 'occurredAt'> }>();
  const removedRelations = new Map<string, WorkspaceData['discussionEdges'][number]>();
  for (const event of [...events].sort((left, right) => right.sequence - left.sequence)) {
    const removedObject = event.eventType === 'object.purged' ? event.payload.removedObject as WorkspaceData['discussionNodes'][number] | undefined : undefined;
    if (removedObject && !removedObjects.has(removedObject.id)) removedObjects.set(removedObject.id, { object: removedObject, event });
    const removedRelation = event.eventType === 'graph.relation.removed' ? event.payload.removedRelation as WorkspaceData['discussionEdges'][number] | undefined : undefined;
    if (removedRelation && !removedRelations.has(removedRelation.id)) removedRelations.set(removedRelation.id, removedRelation);
  }
  const objects: ProjectedObject[] = [
    ...workspace.discussionNodes.map(node => ({
      ref: ref(workspace.projectId, 'conversation', node.id), revision: 1,
      lifecycle: node.status === 'archived' ? 'archived' as const : 'active' as const,
      title: node.title, summary: node.summary, kind: node.kind, ...(node.anchorText ? { anchorText: node.anchorText } : {}),
      status: node.status,
      createdAt: node.createdAt, updatedAt: node.updatedAt, layout: { x: node.x, y: node.y },
    })),
    ...workspace.messages.map(message => ({
      ref: ref(workspace.projectId, 'message', message.id, message.versionGroupId), revision: message.version ?? 1,
      lifecycle: 'active' as const, title: message.kind === 'user' ? 'User message' : 'Assistant message',
      summary: message.text.slice(0, 240), kind: message.kind, createdAt: message.createdAt, updatedAt: message.createdAt,
      status: 'active',
    })),
    ...workspace.resources.map(resource => ({
      ref: ref(workspace.projectId, 'resource', resource.id), revision: Math.max(1, ...workspace.resourceVersions.filter(version => version.resourceId === resource.id).map(version => version.version)),
      lifecycle: 'active' as const, title: resource.logicalName, summary: '', kind: resource.kind,
      status: 'active',
      createdAt: resource.createdAt, updatedAt: resource.createdAt,
    })),
    ...runs.map(run => ({
      ref: ref(workspace.projectId, 'run', run.id), revision: run.attempt,
      lifecycle: 'active' as const, title: `${run.input.executor.model} run`, summary: run.status, kind: 'execution',
      status: run.status,
      createdAt: run.createdAt, updatedAt: run.terminalAt ?? run.createdAt,
    })),
    ...[...removedObjects.values()].flatMap(({ object: removed, event }) => {
      if (workspace.discussionNodes.some(node => node.id === removed.id)) return [];
      return [{
        ref: ref(workspace.projectId, 'conversation', removed.id), revision: event.aggregateRevision,
        lifecycle: 'tombstoned' as const, title: removed.title, summary: removed.summary, kind: removed.kind, status: 'tombstoned',
        createdAt: removed.createdAt, updatedAt: event.occurredAt, layout: { x: removed.x, y: removed.y },
      }];
    }),
  ].sort(byRef);
  const relations: ProjectedRelation[] = [...workspace.discussionEdges.map(edge => ({
    id: edge.id,
    source: ref(workspace.projectId, 'conversation', edge.source),
    target: ref(workspace.projectId, 'conversation', edge.target),
    relationType: legacyRelationCatalog[edge.relation] ?? edge.relation,
    lifecycle: 'active' as const, label: edge.label, createdAt: edge.createdAt,
  })), ...[...removedRelations.values()].flatMap(removed => {
    if (workspace.discussionEdges.some(edge => edge.id === removed.id)) return [];
    return [{
      id: removed.id, source: ref(workspace.projectId, 'conversation', removed.source), target: ref(workspace.projectId, 'conversation', removed.target),
      relationType: legacyRelationCatalog[removed.relation] ?? removed.relation, lifecycle: 'retracted' as const, label: removed.label, createdAt: removed.createdAt,
    }];
  })].sort(byRelation);
  const semantic = { objects, relations };
  return { workspaceId: workspace.projectId, version: 'graph-v1', checkpoint, checksum: semanticStateChecksum({ objects: objects.map(({ layout: _layout, ...object }) => object), relations }), ...semantic };
}

function normalizedLimits(input: { depth?: number; nodeLimit?: number; edgeLimit?: number }) {
  const depth = input.depth ?? 1;
  const nodeLimit = input.nodeLimit ?? 200;
  const edgeLimit = input.edgeLimit ?? 800;
  if (!Number.isInteger(depth) || depth < 0 || depth > 3) throw new Error('depth must be between 0 and 3');
  if (!Number.isInteger(nodeLimit) || nodeLimit < 1 || nodeLimit > 500) throw new Error('nodeLimit must be between 1 and 500');
  if (!Number.isInteger(edgeLimit) || edgeLimit < 0 || edgeLimit > 2_000) throw new Error('edgeLimit must be between 0 and 2000');
  return { depth, nodeLimit, edgeLimit };
}

export function graphNeighborhood(projection: WorkspaceGraphProjection, input: { root?: ObjectRef; depth?: number; nodeLimit?: number; edgeLimit?: number; cursor?: string; objectTypes?: string[] } = {}): GraphQueryResult {
  const { depth, nodeLimit, edgeLimit } = normalizedLimits(input);
  const allowedTypes = input.objectTypes?.length ? new Set(input.objectTypes) : undefined;
  const available = projection.objects.filter(item => !allowedTypes || allowedTypes.has(item.ref.objectType));
  const parts = input.cursor?.split(':') ?? ['0', '0', String(projection.checkpoint)];
  if (parts.length !== 3 || parts.some(part => !/^\d+$/.test(part) || !Number.isSafeInteger(Number(part)))) throw Object.assign(new Error('Invalid graph cursor'), { status: 400, code: 'INVALID_GRAPH_CURSOR' });
  const [offset, edgeOffset, checkpoint] = parts.map(Number) as [number, number, number];
  if (checkpoint !== projection.checkpoint) throw Object.assign(new Error('Graph changed; reload the first page'), { status: 409, code: 'GRAPH_CURSOR_STALE' });
  if (!input.root) {
    const objects = available.slice(offset, offset + nodeLimit);
    // List pages advance objects and relations independently so cross-page edges are retained.
    const eligible = new Set(available.map(item => refKey(item.ref)));
    const relations = projection.relations.filter(item => eligible.has(refKey(item.source)) && eligible.has(refKey(item.target)));
    const page = relations.slice(edgeOffset, edgeOffset + edgeLimit);
    const more = offset + objects.length < available.length || (edgeLimit > 0 && edgeOffset + page.length < relations.length);
    return { version: projection.version, checkpoint: projection.checkpoint, objects, relations: page, ...(more ? { nextCursor: `${offset + objects.length}:${edgeOffset + page.length}:${checkpoint}` } : {}) };
  }
  const objectMap = new Map(available.map(item => [refKey(item.ref), item]));
  const rootKey = refKey(input.root);
  if (!objectMap.has(rootKey)) return { version: projection.version, checkpoint: projection.checkpoint, objects: [], relations: [] };
  const visited = new Set([rootKey]);
  let frontier = new Set([rootKey]);
  const selectedRelations: ProjectedRelation[] = [];
  const selectedRelationIds = new Set<string>();
  const adjacency = new Map<string, ProjectedRelation[]>();
  for (const relation of projection.relations) {
    if (relation.lifecycle !== 'active') continue;
    const source = refKey(relation.source); const target = refKey(relation.target);
    if (!objectMap.has(source) || !objectMap.has(target)) continue;
    if (!adjacency.has(source)) adjacency.set(source, []);
    if (!adjacency.has(target)) adjacency.set(target, []);
    adjacency.get(source)!.push(relation);
    adjacency.get(target)!.push(relation);
  }
  for (let level = 0; level < depth && frontier.size && visited.size < nodeLimit; level += 1) {
    const next = new Set<string>();
    for (const current of frontier) {
      for (const relation of adjacency.get(current) ?? []) {
        if (selectedRelations.length >= edgeLimit) break;
        const source = refKey(relation.source); const target = refKey(relation.target);
        if (!selectedRelationIds.has(relation.id)) { selectedRelationIds.add(relation.id); selectedRelations.push(relation); }
        for (const key of [source, target]) if (!visited.has(key) && visited.size < nodeLimit) { visited.add(key); next.add(key); }
      }
      if (selectedRelations.length >= edgeLimit) break;
    }
    frontier = next;
  }
  const objects = [...visited].map(key => objectMap.get(key)!).filter(Boolean);
  const visible = new Set(objects.map(item => refKey(item.ref)));
  return { version: projection.version, checkpoint: projection.checkpoint, objects, relations: selectedRelations.filter(item => visible.has(refKey(item.source)) && visible.has(refKey(item.target))).slice(0, edgeLimit) };
}

export function graphPath(projection: WorkspaceGraphProjection, from: ObjectRef, to: ObjectRef, nodeLimit = 500): GraphQueryResult {
  normalizedLimits({ nodeLimit });
  const objectMap = new Map(projection.objects.map(item => [refKey(item.ref), item]));
  const empty = { version: projection.version, checkpoint: projection.checkpoint, objects: [], relations: [] };
  if (!objectMap.has(refKey(from)) || !objectMap.has(refKey(to))) return empty;
  const adjacency = new Map<string, Array<{ key: string; relation: ProjectedRelation }>>();
  for (const relation of projection.relations) {
    if (relation.lifecycle !== 'active') continue;
    const source = refKey(relation.source); const target = refKey(relation.target);
    adjacency.set(source, [...(adjacency.get(source) ?? []), { key: target, relation }]);
    adjacency.set(target, [...(adjacency.get(target) ?? []), { key: source, relation }]);
  }
  const start = refKey(from); const goal = refKey(to);
  const queue = [start]; const previous = new Map<string, { key: string; relation: ProjectedRelation }>(); const seen = new Set([start]);
  while (queue.length) {
    const current = queue.shift()!;
    if (current === goal) break;
    for (const adjacent of adjacency.get(current) ?? []) {
      const next = adjacent.key;
      if (seen.size < nodeLimit && objectMap.has(next) && !seen.has(next)) { seen.add(next); previous.set(next, { key: current, relation: adjacent.relation }); queue.push(next); }
    }
  }
  if (!seen.has(goal)) return { version: projection.version, checkpoint: projection.checkpoint, objects: [], relations: [] };
  const keys = [goal]; const relations: ProjectedRelation[] = [];
  while (keys[0] !== start) { const step = previous.get(keys[0]!)!; keys.unshift(step.key); relations.unshift(step.relation); }
  return { version: projection.version, checkpoint: projection.checkpoint, objects: keys.map(key => objectMap.get(key)!), relations };
}

export function graphTree(projection: WorkspaceGraphProjection, root: ObjectRef, depth = 3, nodeLimit = 500): GraphQueryResult {
  const relationTypes = new Set(['derived_from', 'parent_of', 'contains']);
  const filtered = { ...projection, relations: projection.relations.filter(item => relationTypes.has(item.relationType)) };
  return graphNeighborhood(filtered, { root, depth, nodeLimit, edgeLimit: 2_000 });
}

export function graphChanges(projection: WorkspaceGraphProjection, cursor: number, limit = 500) {
  if (!Number.isInteger(cursor) || cursor < 0) throw new Error('cursor must be a non-negative integer');
  return { version: projection.version, checkpoint: projection.checkpoint, resetRequired: cursor !== projection.checkpoint, objects: cursor === projection.checkpoint ? [] : projection.objects.slice(0, Math.min(500, Math.max(1, limit))), relations: cursor === projection.checkpoint ? [] : projection.relations.slice(0, 2_000) };
}
