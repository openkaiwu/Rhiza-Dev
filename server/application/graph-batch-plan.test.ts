import { expect, it } from 'vitest';
import { createSeedWorkspace } from '../seed';
import { prepareForwardGraphBatch, validateGraphBatchRequest } from './graph-batch-plan';

it('freezes ordered archive/relation steps, exact node versions and per-object preparation errors without changing facts', () => {
  const workspace = createSeedWorkspace();
  const [a] = workspace.discussionNodes, b = { ...a, id: 'second-node' };
  workspace.discussionNodes.push(b); const before = structuredClone(workspace);
  const plan = prepareForwardGraphBatch('batch', [{ itemId: 'archive', commandType: 'ArchiveObject', payload: { nodeId: a.id } },
    { itemId: 'foreign', commandType: 'ArchiveObject', payload: { nodeId: 'foreign' } },
    { itemId: 'relate', commandType: 'CreateRelation', payload: { source: a.id, target: b.id, relation: 'references' } }], workspace);
  expect(plan[0]).toMatchObject({ previousStatus: a.status, steps: [{ commandId: 'batch:graph-item:archive:0', commandType: 'ArchiveObject', payload: { nodeId: a.id, expectedNodeVersion: { status: a.status, updatedAt: a.updatedAt } } }] });
  expect(plan[1]).toMatchObject({ error: { code: 'NODE_NOT_FOUND', status: 404 }, steps: [] });
  expect(plan[2].steps[0]).toMatchObject({ commandType: 'CreateRelation', payload: { expectedNodeVersions: [{ nodeId: a.id, status: a.status, updatedAt: a.updatedAt }, { nodeId: b.id, status: b.status, updatedAt: b.updatedAt }] } });
  expect(workspace).toEqual(before);
  a.status = 'archived';
  expect(prepareForwardGraphBatch('batch', [{ itemId: 'archive', commandType: 'ArchiveObject', payload: { nodeId: a.id } }], workspace)[0]).toMatchObject({ skipped: 'ALREADY_ARCHIVED', steps: [] });
});

it('rejects unsupported commands, injected ownership/guards, duplicate items and invalid batch bounds', () => {
  const item = { itemId: 'a', commandType: 'ArchiveObject', payload: { nodeId: 'node' } };
  for (const request of [null, { kind: 'apply', items: [] }, { kind: 'apply', items: Array(101).fill(item) }, { kind: 'apply', items: [item, item] },
    { kind: 'apply', items: [{ ...item, commandType: 'PurgeObject' }] }, { kind: 'apply', items: [{ ...item, payload: { nodeId: 'node', expectedNodeVersion: {} } }] },
    { kind: 'apply', items: [item], ownerId: 'forged' }, { kind: 'undo', batchId: 'batch', itemIds: ['a', 'a'] }]) {
    expect(() => validateGraphBatchRequest(request)).toThrowError(expect.objectContaining({ code: 'INVALID_GRAPH_BATCH', status: 400 }));
  }
  expect(validateGraphBatchRequest({ kind: 'apply', items: [item] })).toEqual({ kind: 'apply', items: [item] });
});
