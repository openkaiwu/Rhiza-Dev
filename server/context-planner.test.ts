// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { chunkText, extractPdfText, planContext, summarizeChunks } from './context-planner';
import { createSeedWorkspace } from './seed';
import type { DiscussionNode, WorkspaceData } from './domain';

function withFile(text: string, chunkCharacters = 80): WorkspaceData {
  const workspace = createSeedWorkspace();
  const id = 'file-research';
  const chunks = chunkText(id, text, chunkCharacters);
  return { ...workspace, attachments: [{ id, name: 'research.txt', mimeType: 'text/plain', size: text.length, kind: 'file', chunkCount: chunks.length, summary: summarizeChunks('research.txt', chunks), createdAt: new Date().toISOString() }], fileChunks: chunks };
}

describe('Context Planner M5', () => {
  it('chunks long resources with provenance instead of retaining extractedText on the file', () => {
    // Large-file throughput remains observed by benchmark:m5; this checks the chunk contract.
    const workspace = withFile('检索证据与来源追踪。\n'.repeat(1_200), 400);
    expect(workspace.attachments[0].size).toBeGreaterThan(10_000);
    expect(workspace.fileChunks.length).toBeGreaterThan(10);
    expect(Math.max(...workspace.fileChunks.map(chunk => chunk.text.length))).toBeLessThanOrEqual(500);
    expect(workspace.fileChunks[1]).toMatchObject({ attachmentId: 'file-research', ordinal: 1 });
    expect(workspace.attachments[0]).not.toHaveProperty('extractedText');
  });

  it('hybrid ranking deterministically selects the relevant chunk and explains why', () => {
    const workspace = withFile(['支付系统采用幂等键避免重复扣款，并使用事务型 outbox。', '园艺团队每周修剪灌木并记录土壤湿度。', '设计系统使用蓝色按钮与八像素网格。'].join('\n'.repeat(20)));
    const first = planContext(workspace, '怎样避免支付重复扣款？');
    const second = planContext(workspace, '怎样避免支付重复扣款？');
    const selected = first.items.find(item => item.sourceType === 'chunk');
    expect(selected?.content).toContain('幂等键');
    expect(selected?.reason).toMatch(/词法命中|语义相似度/);
    expect(second.items.map(item => item.sourceId)).toEqual(first.items.map(item => item.sourceId));
  });

  it('extracts text-showing operators from a PDF before chunk indexing', () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length 64 >>\nstream\nBT /F1 12 Tf (Payment idempotency evidence) Tj ET\nendstream\nendobj\n%%EOF', 'latin1');
    expect(extractPdfText(pdf)).toContain('Payment idempotency evidence');
  });

  it('keeps explicit context ahead of automatic candidates and obeys the remaining token budget', () => {
    const workspace = withFile('支付幂等事务一致性 '.repeat(2_000));
    workspace.contextItems = [{ id: 'explicit', title: '明确约束', detail: '绝不能丢弃', role: 'Constraint', status: 'active', tokens: 120, pinned: true, selectionMode: 'USER_SELECTED', sourceType: 'reference', sourceId: 'constraint' }];
    const result = planContext(workspace, '支付事务', [], 130);
    expect(result.items[0].id).toBe('explicit');
    expect(result.items.filter(item => item.selectionMode === 'AUTO_RETRIEVED')).toHaveLength(0);
  });

  it.each([10, 100, 300])('plans a %i-node project within the local P95 target envelope', nodeCount => {
    const workspace = createSeedWorkspace();
    workspace.contextItems = [];
    workspace.discussionNodes = Array.from({ length: nodeCount }, (_, index): DiscussionNode => ({ id: `node-${index}`, title: `研究节点 ${index}`, summary: index === nodeCount - 1 ? '支付幂等与事务一致性' : `一般产品研究材料 ${index}`, status: 'active', kind: index ? 'branch' : 'main', x: index, y: index, createdAt: workspace.updatedAt, updatedAt: workspace.updatedAt }));
    workspace.activeNodeId = 'node-0';
    workspace.nodeId = 'node-0';
    workspace.messages = workspace.discussionNodes.map((node, index) => ({ id: `message-${index}`, nodeId: node.id, kind: 'assistant' as const, text: node.summary, createdAt: workspace.updatedAt }));
    const samples = Array.from({ length: 20 }, () => planContext(workspace, '支付事务幂等').diagnostics.elapsedMs).sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95) - 1];
    expect(p95).toBeLessThan(2_000);
  });
});
