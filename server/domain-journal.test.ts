import { describe, expect, it } from 'vitest';
import { createSeedWorkspace } from './seed';
import { eventForCommand, type CommandFactContext } from './domain-journal';
import { buildWorkspaceGraphProjection } from './graph-projection/model';

const context = (commandType: string): CommandFactContext => ({
  commandId: `test:${commandType}`, commandType, actor: { actorType: 'human', actorId: 'test' },
  scope: { scopeType: 'workspace', scopeId: 'workspace' }, occurredAt: '2026-09-05T00:00:00.000Z',
});

describe('projection lifecycle event payloads', () => {
  it('identifies the archived/status-changed object and newly created relation instead of the active discussion', () => {
    const before = createSeedWorkspace();
    const node = { ...before.discussionNodes[0], id: 'target', status: 'active' as const };
    before.discussionNodes.push(node);
    const changed = { ...before, discussionNodes: before.discussionNodes.map(item => item.id === node.id ? { ...item, status: 'archived' as const } : item) };
    expect(eventForCommand(context('ArchiveObject'), before, changed, undefined)[0].aggregateId).toBe(node.id);
    expect(eventForCommand(context('ChangeNodeStatus'), before, changed, undefined)[0].aggregateId).toBe(node.id);
    const refreshed = { ...before, discussionNodes: before.discussionNodes.map(item => item.id === node.id ? { ...item, updatedAt: '2026-10-02T00:00:00.000Z' } : item) };
    expect(eventForCommand(context('ChangeNodeStatus'), before, refreshed, undefined)[0].aggregateId).toBe(node.id);
    const edge = { id: 'new-relation', source: before.activeNodeId, target: node.id, relation: 'references' as const, label: '', createdAt: node.createdAt };
    expect(eventForCommand(context('CreateRelation'), before, { ...before, discussionEdges: [...before.discussionEdges, edge] }, undefined)[0].aggregateId).toBe(edge.id);
  });
  it('records the removed relation and purged object needed for an explainable projection', () => {
    const beforeRelation = createSeedWorkspace();
    const target = { ...beforeRelation.discussionNodes[0]!, id: 'target' };
    const relation = { id: 'edge', source: beforeRelation.activeNodeId, target: target.id, relation: 'references' as const, label: 'reference', createdAt: target.createdAt };
    beforeRelation.discussionNodes.push(target); beforeRelation.discussionEdges.push(relation);
    const afterRelation = { ...beforeRelation, discussionEdges: [] };
    expect(eventForCommand(context('RemoveRelation'), beforeRelation, afterRelation, undefined)[0]?.payload.removedRelation).toEqual(relation);

    const afterPurge = { ...afterRelation, discussionNodes: afterRelation.discussionNodes.filter(node => node.id !== target.id) };
    expect(eventForCommand(context('PurgeObject'), afterRelation, afterPurge, undefined)[0]?.payload.removedObject).toEqual({ id: target.id, kind: target.kind, createdAt: target.createdAt, x: target.x, y: target.y });
    const fact = eventForCommand(context('PurgeObject'), beforeRelation, afterPurge, undefined)[0]!;
    expect(fact.payload.removedRelations).toEqual([{ id: relation.id, source: relation.source, target: relation.target, relation: relation.relation, createdAt: relation.createdAt, label: '' }]);
    const projection = buildWorkspaceGraphProjection(afterPurge, [], 1, [{ ...fact, sequence: 1, aggregateRevision: 1, occurredAt: context('PurgeObject').occurredAt }]);
    expect(projection.objects.find(item => item.ref.objectId === target.id)).toMatchObject({
      lifecycle: 'tombstoned', title: '[purged]', summary: '', kind: target.kind,
      createdAt: target.createdAt, layout: { x: target.x, y: target.y },
    });
    expect(JSON.stringify(fact.payload)).not.toContain(target.title);
    expect(JSON.stringify(fact.payload)).not.toContain(target.summary);
    expect(projection.relations).toContainEqual(expect.objectContaining({ id: relation.id, lifecycle: 'retracted', label: '', source: expect.objectContaining({ objectId: relation.source }), target: expect.objectContaining({ objectId: relation.target }) }));
  });
});
