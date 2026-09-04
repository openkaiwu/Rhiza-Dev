import { describe, expect, it } from 'vitest';
import { createSeedWorkspace } from '../seed';
import {
  buildWorkspaceGraphProjection,
  graphChanges,
  graphNeighborhood,
  graphPath,
  graphTree,
  type ProjectedObject,
} from './model';
import type { ExecutionRun } from '../execution-runtime/run';
import type { DomainEventEnvelope } from '../domain-journal';

describe('Workspace Graph Projection', () => {
  it('maps current object families, legacy relations, lifecycle and layout without leaking storage details', () => {
    const workspace = createSeedWorkspace();
    const branch = {
      ...workspace.discussionNodes[0]!,
      id: 'branch',
      title: 'Branch',
      kind: 'branch' as const,
      status: 'archived' as const,
      sourceNodeId: workspace.activeNodeId,
      x: 420,
      y: 240,
    };
    workspace.discussionNodes.push(branch);
    workspace.discussionEdges.push({ id: 'edge', source: workspace.activeNodeId, target: branch.id, relation: 'derived-from', label: 'branch', createdAt: branch.createdAt });
    workspace.resources.push({ id: 'resource', workspaceId: workspace.projectId, kind: 'attachment', logicalName: 'notes.md', createdAt: branch.createdAt });

    const projection = buildWorkspaceGraphProjection(workspace, [{
      id: 'run', workspaceId: workspace.projectId, nodeId: workspace.activeNodeId, commandId: 'command', status: 'completed', attempt: 1,
      inputHash: 'hash', createdAt: branch.createdAt, terminalAt: branch.createdAt,
      input: { schemaVersion: '1.0.0', executor: { runtime: 'test', modelSpecRef: 'model', providerEndpointRef: 'provider', model: 'model', provider: 'provider' }, request: { requestId: 'run', projectId: workspace.projectId, nodeId: workspace.activeNodeId, prompt: 'hi', history: [], contextItems: [], attachments: [], manifestId: 'manifest', mode: 'Assisted', modelId: 'model', generation: { temperature: 0, topP: 1, maxTokens: 1 }, operation: 'send' } },
      telemetry: { traceCount: 0 },
    } satisfies ExecutionRun], 7);

    expect(new Set(projection.objects.map(item => item.ref.objectType))).toEqual(new Set(['conversation', 'message', 'resource', 'run']));
    expect(projection.objects.find(item => item.ref.objectId === 'branch')).toMatchObject({ lifecycle: 'archived', layout: { x: 420, y: 240 } });
    expect(projection.relations).toContainEqual(expect.objectContaining({ id: 'edge', relationType: 'derived_from', lifecycle: 'active' }));
    expect(projection.checkpoint).toBe(7);
    expect(projection.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('keeps generic object types additive and bounds neighborhood, path, tree and changes queries', () => {
    const workspaceId = 'workspace';
    const objects: ProjectedObject[] = Array.from({ length: 700 }, (_, index) => ({
      ref: { workspaceId, objectType: index === 699 ? 'future-task' : 'conversation', objectId: `n${index}` },
      revision: 1, lifecycle: 'active', title: `Node ${index}`, summary: '', kind: index ? 'branch' : 'main', status: 'active',
      createdAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T00:00:00.000Z', layout: { x: index, y: index },
    }));
    const relations = objects.slice(1).map((object, index) => ({
      id: `e${index}`, source: objects[index]!.ref, target: object.ref, relationType: 'derived_from', lifecycle: 'active' as const, label: '', createdAt: object.createdAt,
    }));
    const projection = { workspaceId, version: 'graph-v1' as const, checkpoint: 9, checksum: 'x', objects, relations };

    const neighborhood = graphNeighborhood(projection, { root: objects[0]!.ref, depth: 3, nodeLimit: 500, edgeLimit: 2_000 });
    expect(neighborhood.objects.length).toBeLessThanOrEqual(500);
    expect(neighborhood.relations.length).toBeLessThanOrEqual(2_000);
    expect(() => graphNeighborhood(projection, { depth: 4 })).toThrow('depth must be between 0 and 3');
    expect(graphPath(projection, objects[0]!.ref, objects[3]!.ref, 10).objects.map(item => item.ref.objectId)).toEqual(['n0', 'n1', 'n2', 'n3']);
    expect(graphTree(projection, objects[0]!.ref, 2, 20).objects).toHaveLength(3);
    expect(graphChanges(projection, 8, 10)).toMatchObject({ checkpoint: 9, resetRequired: true });
    expect(projection.objects.at(-1)?.ref.objectType).toBe('future-task');
  });

  it('keeps purge tombstones and retracted relations explainable without restoring them to active traversal', () => {
    const workspace = createSeedWorkspace();
    const removed = { ...workspace.discussionNodes[0]!, id: 'removed', title: 'Removed', status: 'archived' as const };
    const relation = { id: 'removed-edge', source: workspace.activeNodeId, target: removed.id, relation: 'references' as const, label: 'historical', createdAt: removed.createdAt };
    const events = [{ eventType: 'object.purged', sequence: 8, aggregateRevision: 2, occurredAt: removed.updatedAt, payload: { removedObject: removed } },
      { eventType: 'graph.relation.removed', sequence: 9, aggregateRevision: 3, occurredAt: removed.updatedAt, payload: { removedRelation: relation } }] as unknown as DomainEventEnvelope[];
    const projection = buildWorkspaceGraphProjection(workspace, [], 9, events);

    expect(projection.objects).toContainEqual(expect.objectContaining({ ref: expect.objectContaining({ objectId: 'removed' }), lifecycle: 'tombstoned' }));
    expect(projection.relations).toContainEqual(expect.objectContaining({ id: 'removed-edge', lifecycle: 'retracted' }));
    expect(graphNeighborhood(projection, { root: projection.objects[0]!.ref, depth: 3 }).relations).not.toContainEqual(expect.objectContaining({ id: 'removed-edge' }));
  });
});
