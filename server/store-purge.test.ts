import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSeedWorkspace } from './seed';
import { validateWorkspaceHistoryUpdate } from './store';

describe('Purge history boundary', () => {
  it('rejects a node removal that leaves an attached ResourceVersion readable', () => {
    const current = createSeedWorkspace();
    const nodeId = randomUUID();
    const messageId = randomUUID();
    const attachmentId = randomUUID();
    const receiptId = randomUUID();
    const createdAt = new Date().toISOString();
    const previous = {
      ...current,
      discussionNodes: [...current.discussionNodes, { id: nodeId, title: 'secret', summary: '', status: 'archived' as const,
        kind: 'branch' as const, sourceNodeId: current.activeNodeId, x: 0, y: 0, createdAt, updatedAt: createdAt }],
      messages: [...current.messages, { id: messageId, nodeId, kind: 'user' as const, text: 'secret', attachmentIds: [attachmentId], createdAt }],
      attachments: [...current.attachments, { id: attachmentId, name: 'secret.txt', mimeType: 'text/plain', size: 6,
        kind: 'file' as const, createdAt }],
    };
    const next = {
      ...previous,
      discussionNodes: previous.discussionNodes.filter(node => node.id !== nodeId),
      messages: previous.messages.filter(message => message.id !== messageId),
      auditEvents: [...previous.auditEvents, { id: receiptId, projectId: previous.projectId, nodeId,
        action: 'node.purged', entityType: 'node' as const, entityId: nodeId, metadata: { reason: 'test' }, createdAt }],
    };
    try {
      validateWorkspaceHistoryUpdate(previous, next, { purge: { nodeId, auditReceiptId: receiptId } });
      throw new Error('Purge unexpectedly succeeded');
    } catch (error) {
      expect(error).toMatchObject({ code: 'PURGE_HAS_RESOURCE_HISTORY', status: 409 });
    }
  });
});
