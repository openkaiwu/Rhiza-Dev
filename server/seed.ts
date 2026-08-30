import type { WorkspaceData } from './domain';

export function createSeedWorkspace(): WorkspaceData {
  const createdAt = new Date().toISOString();
  return {
    projectId: 'rhiza-product-research',
    projectTitle: 'Rhiza 产品研究',
    nodeId: 'information-architecture',
    mode: 'Assisted',
    contextItems: [
      { id: 'c1', title: '信息架构方向', detail: '当前讨论节点 · 包含本节点最近的对话历史', role: 'Constraint', status: 'active', tokens: 1840, selectionMode: 'CURRENT', sourceType: 'node', sourceId: 'information-architecture', sourceNodeId: 'information-architecture', pinned: false, contentVersion: 1, reason: '当前讨论节点始终进入本轮上下文。' },
      { id: 'c2', title: '访谈发现 · 第 02 轮', detail: '用户对上下文失控的高频反馈', role: 'Fact', status: 'active', tokens: 2360, selectionMode: 'USER_SELECTED', sourceType: 'reference', sourceId: 'interview-round-02', pinned: true, contentVersion: 1, reason: '由用户显式加入并固定。' },
      { id: 'c3', title: '竞品模式拆解', detail: '与当前讨论有 86% 语义关联', role: 'Reference', status: 'recommended', tokens: 1120, sourceType: 'reference', sourceId: 'competitor-patterns', contentVersion: 1, reason: '当前问题涉及信息架构，该节点包含竞品导航模式的对照结论。' },
      { id: 'c4', title: '早期定价假设', detail: '已被新版商业假设替代', role: 'Decision', status: 'excluded', tokens: 760, sourceType: 'reference', sourceId: 'pricing-assumption-v1', contentVersion: 1, reason: '用户显式排除：该假设已失效。' },
    ],
    messages: [
      { id: 'm1', nodeId: 'information-architecture', segmentId: 'segment-information-architecture-0', kind: 'user', text: '结合前两轮访谈，我们应该怎样组织产品的首屏信息架构？重点考虑专业用户，但不要让首次进入的人觉得复杂。', createdAt: '2026-08-09T12:00:00.000Z' },
      { id: 'm2', nodeId: 'information-architecture', segmentId: 'segment-information-architecture-0', kind: 'assistant', text: '我建议首屏采用“聚焦工作区 + 渐进式上下文”的双层结构。用户首先进入单一讨论流，项目结构、图谱与状态都作为邻近但不抢占注意力的能力存在。', createdAt: '2026-08-09T12:00:10.000Z' },
    ],
    attachments: [],
    resources: [],
    resourceVersions: [],
    materializations: [],
    fileChunks: [],
    discussionNodes: [{ id: 'information-architecture', title: '信息架构方向', summary: '探索首屏的内容层级、上下文入口与专业能力的渐进呈现方式。', status: 'active', kind: 'main', x: 350, y: 150, createdAt, updatedAt: createdAt }],
    discussionEdges: [],
    anchors: [],
    activeNodeId: 'information-architecture',
    manifests: [],
    segments: [{ id: 'segment-information-architecture-0', nodeId: 'information-architecture', ordinal: 0, title: '首屏信息架构', createdAt }],
    auditEvents: [],
    updatedAt: new Date().toISOString(),
  };
}
