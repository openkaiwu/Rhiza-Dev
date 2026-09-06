import type { ContextHistory } from '../types';

export const contextHistoryFixture: ContextHistory = {
  manifest: {
    schemaVersion: '1.0.0', id: 'manifest-context-v1', projectId: 'workspace-fixture', nodeId: 'node-fixture', requestId: 'request-fixture', createdAt: '2026-09-06T02:00:00.000Z',
    mode: 'Strict', provider: 'Test Provider', model: 'context-model', runtime: 'provider-adapter', operation: 'send', attachmentIds: [], contextItemIds: ['evidence', 'constraint'], excludedItemIds: ['excluded'],
    estimatedTokens: 2100, generation: { temperature: 0.4, topP: 1, maxTokens: 2048 }, planner: { candidateCount: 5, selectedCount: 2, elapsedMs: 2, fallback: false, budget: 2000, usedTokens: 2100 },
    versions: { planner: 'deterministic-v1', compiler: 'frozen-resource-v1', contributors: { lexical: 'lexical-v1' }, tokenizer: 'nfkc-cjk-bigram-v1', selectionPolicy: 'explicit-first-v1' },
    cache: { key: 'cache-fixture', reason: 'sources_changed', vector: {} },
    contextItems: [
      { sourceType: 'node', sourceId: 'research-interviews', title: '用户访谈 · 首屏信息架构', detail: '访谈摘要', role: 'Fact', selectionMode: 'CURRENT', pinned: false, reason: '当前讨论提供本轮问题的背景与已确认事实。', priority: 0, tokenCount: 1500, contentVersion: 1, resourceId: 'resource-evidence', resourceVersionId: 'fe2389a3-7525-463b-a8d1-c86743801321', digest: 'a'.repeat(64), contributorVersion: 'lexical-v1' },
      { sourceType: 'reference', sourceId: 'accessibility', title: '可访问性约束', detail: '约束记录', role: 'Constraint', selectionMode: 'USER_SELECTED', pinned: true, reason: '用户固定：关键操作必须支持键盘与屏幕阅读器。', priority: 1, tokenCount: 600, contentVersion: 1, resourceId: 'resource-missing', resourceVersionId: 'fe2389a3-7525-463b-a8d1-c86743801322', digest: 'b'.repeat(64), contributorVersion: 'lexical-v1' },
    ],
    omissions: [
      { sourceType: 'reference', sourceId: 'old-pricing', title: '旧定价假设', tokenCount: 400, code: 'excluded', reason: '用户明确排除：该假设已被最新访谈否定。' },
      { sourceType: 'segment', sourceId: 'related', title: '邻近讨论片段', tokenCount: 800, code: 'strict', reason: 'Strict 模式只使用显式选择的来源。' },
    ],
  },
  sources: [
    { sourceId: 'research-interviews', status: 'resolved', content: '专业用户希望直接进入当前讨论。\n首次进入时，以逐步展示的方式介绍来源、上下文与讨论图谱。', resourceVersion: { id: 'fe2389a3-7525-463b-a8d1-c86743801321', version: 1, digest: 'a'.repeat(64) } },
    { sourceId: 'accessibility', status: 'missing_resource' },
  ],
};
