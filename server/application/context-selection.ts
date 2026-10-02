import type { ContextItem, WorkspaceData } from '../domain';
import type { ContextPlannerPort } from '../context-runtime/port';
import { contextSourceSnapshot } from '../context-runtime/source-snapshot';
import { activeContextSelection, estimateTokens } from '../context-runtime/port';
import { applicationError } from '../contracts/application-error';
import type { ConfirmContextSelection, ContextSelectionPreview, ContextSourceRef } from '../contracts/context-selection';

const conflict = (message: string, code: string) => applicationError(message, code, 'conflict', 'refresh', false, 409);
const invalid = () => applicationError('请选择 1–100 个不同的讨论或片段来源。', 'INVALID_CONTEXT_SELECTION', 'validation', 'none', false, 400);

function sourcesFor(value: unknown, reviewed: boolean): Array<ContextSourceRef & { sourceRevision?: string }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw invalid();
  const seen = new Set<string>();
  return value.map(source => {
    if (!source || typeof source !== 'object' || Array.isArray(source)
      || !['node', 'segment'].includes(source.sourceType) || typeof source.sourceId !== 'string' || !source.sourceId.trim() || source.sourceId.length > 2000
      || Object.keys(source).some(key => !['sourceType', 'sourceId', ...(reviewed ? ['sourceRevision', 'title', 'tokens'] : [])].includes(key))
      || (reviewed && (typeof source.sourceRevision !== 'string' || !/^[a-f0-9]{64}$/.test(source.sourceRevision)))) throw invalid();
    const key = `${source.sourceType}:${source.sourceId}`;
    if (seen.has(key)) throw invalid();
    seen.add(key);
    return { sourceType: source.sourceType, sourceId: source.sourceId, ...(reviewed ? { sourceRevision: source.sourceRevision } : {}) };
  });
}

function proposal(workspace: WorkspaceData, sources: Array<ContextSourceRef & { sourceRevision?: string }>, planner: ContextPlannerPort, budget: number, id: () => string) {
  const node = workspace.discussionNodes.find(node => node.id === workspace.activeNodeId);
  if (!node || node.status === 'archived') throw conflict('当前执行讨论不存在或已归档。', 'CONTEXT_TARGET_UNAVAILABLE');
  const contextItems = [...workspace.contextItems];
  const reviewed = sources.map(source => {
    const snapshot = contextSourceSnapshot(workspace, source.sourceType, source.sourceId);
    if (!snapshot) throw conflict('所选来源不存在、已归档或不属于此工作区。', 'CONTEXT_SOURCE_NOT_FOUND');
    if (source.sourceRevision && source.sourceRevision !== snapshot.sourceRevision) throw conflict('来源已变化，请重新预览并确认。', 'CONTEXT_SELECTION_STALE');
    const index = contextItems.findIndex(item => item.sourceType === source.sourceType && item.sourceId === source.sourceId);
    const existing = contextItems[index];
    const item: ContextItem = { ...existing, id: existing?.id ?? id(), title: snapshot.title, detail: existing?.detail ?? '由图谱选择并审阅的来源',
      role: existing?.role ?? 'Reference', status: 'active', sourceType: source.sourceType, sourceId: source.sourceId, sourceNodeId: snapshot.nodeId,
      content: snapshot.content, sourceRevision: snapshot.sourceRevision, tokens: estimateTokens(snapshot.content), selectionMode: 'USER_SELECTED',
      pinned: Boolean(existing?.pinned), reason: '由用户预览并确认的图谱来源。' };
    if (index < 0) contextItems.push(item); else contextItems[index] = item;
    return { ...source, sourceRevision: snapshot.sourceRevision, title: snapshot.title, tokens: item.tokens };
  });
  const next = { ...workspace, contextItems };
  const explicit = new Set(activeContextSelection(next.mode, next.contextItems));
  if (explicit.size > 500) throw invalid();
  // Match production indexed planning against actual source bytes without persisting
  // refreshed legacy contents or changing any previously reviewed revision.
  const planning = { ...next, contextItems: next.contextItems.map(item => {
    if (!explicit.has(item)) return item;
    const snapshot = contextSourceSnapshot(next, item.sourceType ?? 'reference', item.sourceId ?? item.id);
    if (!snapshot) throw conflict('已选来源不存在、已归档或不属于此工作区。', 'CONTEXT_SOURCE_NOT_FOUND');
    return { ...item, content: snapshot.content, tokens: estimateTokens(snapshot.content) };
  }) };
  // Use the existing deterministic planner and its exact explicit-source budget accounting.
  const plan = planner.plan(planning, '', [], budget);
  if (reviewed.some(source => !plan.items.some(item => item.sourceType === source.sourceType && item.sourceId === source.sourceId && item.sourceRevision === source.sourceRevision)))
    throw conflict('所选来源未完整进入本轮计划，请重新预览。', 'CONTEXT_SELECTION_INCOMPLETE');
  const overBudget = plan.diagnostics.usedTokens > budget || plan.omissions?.some(item => item.code === 'budget'
    && reviewed.some(source => source.sourceType === item.sourceType && source.sourceId === item.sourceId)) === true;
  const preview: ContextSelectionPreview = { workspaceId: workspace.projectId, expectedNodeId: workspace.activeNodeId, sources: reviewed,
    budget, usedTokens: plan.diagnostics.usedTokens, overBudget, status: overBudget ? 'over_budget' : 'ready' };
  return { next, preview };
}

/** Read-only proposal. No Context state, receipts, frozen Blobs or Runtime work are published. */
export function prepareContextSelection(workspace: WorkspaceData, sources: unknown, planner: ContextPlannerPort, budget: number): ContextSelectionPreview {
  let sequence = 0;
  return proposal(workspace, sourcesFor(sources, false), planner, budget, () => `context-preview:${++sequence}`).preview;
}

/** Called inside the existing Workspace mutation transaction, before any business facts are written. */
export function confirmContextSelection(workspace: WorkspaceData, input: ConfirmContextSelection, planner: ContextPlannerPort, budget: number, id: () => string): WorkspaceData {
  if (!input || typeof input.expectedNodeId !== 'string' || !input.expectedNodeId.trim() || input.expectedNodeId.length > 2000) throw invalid();
  if (input.expectedNodeId !== workspace.activeNodeId) throw conflict('当前执行讨论已变化，请重新预览。', 'CONTEXT_TARGET_CHANGED');
  const result = proposal(workspace, sourcesFor(input.sources, true), planner, budget, id);
  if (result.preview.overBudget) throw conflict('所选来源超过上下文预算，请减少来源后重新预览。', 'CONTEXT_BUDGET_EXCEEDED');
  return result.next;
}
