import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { SealedReceiptContent } from './sealed-receipt-content';
import { SealedMessageContent } from './sealed-message-content';

it('preserves both receipt kinds and other workspaces while reclaiming unpublished content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-sealed-reclaim-'));
  try {
    const receipts = SealedReceiptContent.atDirectory(root);
    const result = await receipts.seal('a', 'command', { result: true });
    const error = await receipts.seal('a', 'command', { error: true }, 'error');
    const other = await receipts.seal('b', 'command', { other: true });
    const orphan = await receipts.seal('a', 'orphan', { secret: true });
    const references = [
      { workspaceId: 'a', commandId: 'command', reference: result, kind: 'result' as const },
      { workspaceId: 'a', commandId: 'command', reference: error, kind: 'error' as const },
      { workspaceId: 'b', commandId: 'command', reference: other, kind: 'result' as const },
    ];
    expect(await receipts.revokeUnreferencedKeys(references)).toBe(1);
    expect(await receipts.read('a', 'command', result)).toEqual({ result: true });
    expect(await receipts.read('a', 'command', error, 'error')).toEqual({ error: true });
    expect(await receipts.read('b', 'command', other)).toEqual({ other: true });
    await expect(receipts.read('a', 'orphan', orphan)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect(await receipts.revokeUnreferencedKeys(references)).toBe(0);

    const messages = SealedMessageContent.atDirectory(join(root, 'messages'));
    const old = await messages.seal('a', 'message', { text: 'old' });
    const current = await messages.seal('a', 'message', { text: 'current' });
    expect(await messages.revokeUnreferencedKeys([{ workspaceId: 'a', id: 'message', contentId: current.contentId }])).toBe(1);
    expect(await messages.read('a', 'message', current)).toEqual({ text: 'current' });
    await expect(messages.read('a', 'message', old)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
  } finally { await rm(root, { recursive: true, force: true }); }
});
