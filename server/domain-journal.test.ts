import { describe, expect, it } from 'vitest';
import { createSeedWorkspace } from './seed';
import { eventForCommand, type CommandFactContext } from './domain-journal';

const context = (commandType: string): CommandFactContext => ({
  commandId: `test:${commandType}`, commandType, actor: { actorType: 'human', actorId: 'test' },
  scope: { scopeType: 'workspace', scopeId: 'workspace' }, occurredAt: '2026-09-05T00:00:00.000Z',
});

describe('projection lifecycle event payloads', () => {
  it('records the removed relation and purged object needed for an explainable projection', () => {
    const beforeRelation = createSeedWorkspace();
    const target = { ...beforeRelation.discussionNodes[0]!, id: 'target' };
    const relation = { id: 'edge', source: beforeRelation.activeNodeId, target: target.id, relation: 'references' as const, label: 'reference', createdAt: target.createdAt };
    beforeRelation.discussionNodes.push(target); beforeRelation.discussionEdges.push(relation);
    const afterRelation = { ...beforeRelation, discussionEdges: [] };
    expect(eventForCommand(context('RemoveRelation'), beforeRelation, afterRelation, undefined)[0]?.payload.removedRelation).toEqual(relation);

    const afterPurge = { ...afterRelation, discussionNodes: afterRelation.discussionNodes.filter(node => node.id !== target.id) };
    expect(eventForCommand(context('PurgeObject'), afterRelation, afterPurge, undefined)[0]?.payload.removedObject).toEqual(target);
  });
});
