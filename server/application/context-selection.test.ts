import { describe, expect, it } from 'vitest';
import { createSeedWorkspace } from '../seed';
import { LegacyContextPlanner } from '../context-runtime/legacy-planner';
import { validateContextConfirmation } from '../context-runtime/source-snapshot';
import { prepareContextSelection, confirmContextSelection } from './context-selection';

function selectedWorkspace() {
  const workspace = createSeedWorkspace();
  workspace.discussionNodes.push({ ...workspace.discussionNodes[0], id: 'other-node', title: 'Other source', status: 'active' });
  return workspace;
}

describe('reviewed Context selection', () => {
  it('uses the existing planner to preview and atomically confirm exact reviewed sources', () => {
    const workspace = selectedWorkspace();
    const sourceId = workspace.discussionNodes.find(node => node.id !== workspace.activeNodeId && node.status !== 'archived')!.id;
    const planner = new LegacyContextPlanner(() => 'context-id');
    const preview = prepareContextSelection(workspace, [{ sourceType: 'node', sourceId }], planner, 32_000);
    expect(preview).toMatchObject({ workspaceId: workspace.projectId, expectedNodeId: workspace.activeNodeId, status: 'ready', overBudget: false, budget: 32_000,
      sources: [{ sourceType: 'node', sourceId, sourceRevision: expect.stringMatching(/^[a-f0-9]{64}$/), tokens: expect.any(Number) }] });
    const next = confirmContextSelection(workspace, { expectedNodeId: preview.expectedNodeId, sources: preview.sources }, planner, 32_000, () => 'reviewed-item');
    const item = next.contextItems.find(item => item.sourceId === sourceId)!;
    expect(item).toMatchObject({ sourceRevision: preview.sources[0].sourceRevision, selectionMode: 'USER_SELECTED', status: 'active' });
    expect(planner.plan(next, '', [], 32_000).items.find(item => item.sourceId === sourceId)?.content).toBe(item.content);
    expect(workspace.contextItems.some(item => item.id === 'reviewed-item')).toBe(false);
  });

  it('rejects changed target, stale source and excessive budget before publishing any selection', () => {
    const workspace = selectedWorkspace();
    const sources = workspace.discussionNodes.filter(node => node.status !== 'archived').slice(0, 2).map(node => ({ sourceType: 'node' as const, sourceId: node.id }));
    const planner = new LegacyContextPlanner(() => 'context-id');
    const preview = prepareContextSelection(workspace, sources, planner, 32_000);
    const before = structuredClone(workspace);
    expect(() => confirmContextSelection(workspace, { expectedNodeId: 'wrong', sources: preview.sources }, planner, 32_000, () => 'new')).toThrow('当前执行讨论已变化');
    expect(() => confirmContextSelection(workspace, { expectedNodeId: workspace.activeNodeId, sources: preview.sources.map((source, index) => index ? { ...source, sourceRevision: 'f'.repeat(64) } : source) }, planner, 32_000, () => 'new')).toThrow('来源已变化');
    expect(prepareContextSelection(workspace, sources, planner, 1)).toMatchObject({ status: 'over_budget', overBudget: true });
    expect(() => confirmContextSelection(workspace, { expectedNodeId: workspace.activeNodeId, sources: preview.sources }, planner, 1, () => 'new')).toThrow('所选来源超过上下文预算');
    expect(workspace).toEqual(before);
  });

  it('requires reviewed USER_SELECTED revisions to stay unchanged while preserving legacy selection behavior', () => {
    const item = { id: 'selected', title: 'Selected', detail: '', role: 'Reference' as const, status: 'active' as const, tokens: 1, selectionMode: 'USER_SELECTED' as const, sourceRevision: 'a'.repeat(64) };
    expect(() => validateContextConfirmation(item, 'b'.repeat(64))).toThrow('来源已变化');
    expect(() => validateContextConfirmation({ ...item, sourceRevision: undefined }, 'b'.repeat(64))).not.toThrow();
  });

  it('budgets the current source body instead of stale saved tokens without rewriting unrelated Context facts', () => {
    const workspace = selectedWorkspace();
    workspace.mode = 'Strict';
    workspace.contextItems = [{ ...workspace.contextItems[0], tokens: 1, content: 'Old small body' }];
    workspace.messages[0] = { ...workspace.messages[0], text: 'x'.repeat(140_000) };
    const before = structuredClone(workspace);
    const planner = new LegacyContextPlanner(() => 'context-id');
    const sources = [{ sourceType: 'node' as const, sourceId: 'other-node' }];
    const preview = prepareContextSelection(workspace, sources, planner, 32_000);
    expect(preview).toMatchObject({ status: 'over_budget', overBudget: true });
    expect(preview.usedTokens).toBeGreaterThan(preview.budget);
    expect(preview.sources[0].tokens).toBeLessThan(preview.budget);
    expect(() => confirmContextSelection(workspace, { expectedNodeId: preview.expectedNodeId, sources: preview.sources }, planner, 32_000, () => 'reviewed-item')).toThrow('所选来源超过上下文预算');
    expect(workspace).toEqual(before);

    workspace.messages[0] = { ...workspace.messages[0], text: 'Small current body' };
    const allowed = prepareContextSelection(workspace, sources, planner, 32_000);
    const next = confirmContextSelection(workspace, { expectedNodeId: allowed.expectedNodeId, sources: allowed.sources }, planner, 32_000, () => 'reviewed-item');
    expect(allowed.status).toBe('ready');
    expect(next.contextItems[0]).toEqual(before.contextItems[0]);
  });
});
