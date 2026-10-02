// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { RepositoryWorkspaceUnitOfWork } from '../server/infrastructure/workspace-repository-unit-of-work';

it('queries a current scoped projection without loading the whole graph, including after a command', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m11-graph-'));
  const store = await openEmbeddedWorkspaceStore(join(root, 'db'));
  try {
    const workspace = await store.read();
    await store.readGraphProjection();
    const read = vi.spyOn(store, 'readGraphProjection').mockRejectedValue(new Error('full graph read forbidden'));
    const uow = new RepositoryWorkspaceUnitOfWork(store);
    const first = await uow.queryGraphNeighborhood({ nodeLimit: 2, edgeLimit: 1, objectTypes: ['conversation'] });
    expect(first.objects.length).toBeLessThanOrEqual(2);
    await store.executeCommand({ context: { commandId: randomUUID(), commandType: 'RenameConversation', actor: { actorType: 'system', actorId: 'test' }, scope: { scopeType: 'workspace', scopeId: workspace.projectId }, occurredAt: new Date().toISOString() },
      apply: async current => ({ next: { ...current, discussionNodes: current.discussionNodes.map(node => node.id === workspace.activeNodeId ? { ...node, title: 'bounded update' } : node) }, value: null }),
      events: () => [{ eventType: 'graph.node.status_changed', aggregateType: 'node', aggregateId: workspace.activeNodeId, payload: {} }] });
    const next = await uow.queryGraphNeighborhood({ root: { workspaceId: workspace.projectId, objectType: 'conversation', objectId: workspace.activeNodeId }, depth: 1, nodeLimit: 2, edgeLimit: 1 });
    expect(next.objects.find(item => item.ref.objectId === workspace.activeNodeId)?.title).toBe('bounded update');
    expect(read).not.toHaveBeenCalled();
    await expect(uow.queryGraphNeighborhood({ root: { workspaceId: randomUUID(), objectType: 'conversation', objectId: workspace.activeNodeId } })).rejects.toMatchObject({ code: 'WORKSPACE_REFERENCE_MISMATCH' });
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});
