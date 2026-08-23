import { attachmentContextItem, chunkText, estimateTokens, planContext, summarizeChunks } from '../context-planner';
import type { ContextItem, WorkspaceData } from '../domain';
import type { ContextPlannerPort } from './port';

/**
 * Compatibility adapter for the M01 planner. The Application layer sees only
 * the small planner port; tokenization/chunking implementation details remain
 * behind this context-runtime boundary.
 */
export class LegacyContextPlanner implements ContextPlannerPort {
  constructor(private readonly id: () => string) {}

  plan(workspace: WorkspaceData, prompt: string, attachmentIds: string[], budget: number) {
    return planContext(workspace, prompt, attachmentIds, budget);
  }

  sourceItem(workspace: WorkspaceData, sourceType: 'node' | 'segment' | 'file', sourceId: string): ContextItem {
    if (sourceType === 'file') {
      const attachment = workspace.attachments.find(item => item.id === sourceId);
      if (!attachment) throw legacyPlannerError('Context 来源文件不存在。', 404, 'CONTEXT_SOURCE_NOT_FOUND');
      return attachmentContextItem(attachment);
    }
    if (sourceType === 'node') {
      const node = workspace.discussionNodes.find(item => item.id === sourceId);
      if (!node) throw legacyPlannerError('Context 来源节点不存在。', 404, 'CONTEXT_SOURCE_NOT_FOUND');
      const body = workspace.messages.filter(message => message.nodeId === node.id).map(message => message.text).join('\n');
      return {
        id: this.id(), title: node.title, detail: `讨论节点 · ${node.summary}`, role: 'Reference', status: 'active',
        tokens: estimateTokens(`${node.summary}\n${body}`), selectionMode: 'USER_SELECTED', sourceType, sourceId: node.id,
        sourceNodeId: node.id, pinned: false, contentVersion: 1, reason: '由用户显式加入的讨论节点。',
      };
    }
    const segment = workspace.segments.find(item => item.id === sourceId);
    if (!segment) throw legacyPlannerError('Context 来源片段不存在。', 404, 'CONTEXT_SOURCE_NOT_FOUND');
    const node = workspace.discussionNodes.find(item => item.id === segment.nodeId);
    const body = workspace.messages.filter(message => message.segmentId === segment.id).map(message => message.text).join('\n');
    return {
      id: this.id(), title: segment.title, detail: `片段 · 来自 ${node?.title || '未知节点'}`, role: 'Reference', status: 'active',
      tokens: estimateTokens(body || segment.title), selectionMode: 'USER_SELECTED', sourceType, sourceId: segment.id,
      sourceNodeId: segment.nodeId, pinned: false, contentVersion: 1, reason: '由用户显式加入的讨论片段。',
    };
  }

  processAttachment(attachmentId: string, name: string, _mimeType: string, text: string) {
    const chunks = text ? chunkText(attachmentId, text) : [];
    return { chunks, summary: summarizeChunks(name, chunks) };
  }
}

function legacyPlannerError(message: string, status: number, code: string): Error & { status: number; code: string } {
  return Object.assign(new Error(message), { status, code });
}
