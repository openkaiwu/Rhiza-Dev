import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { SealedMessageContent } from './sealed-message-content';
import { NodeFilesystemBlobStore } from './node-host-runtime';

it('encrypts message text, reasoning and tool content together and isolates revocation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-message-content-'));
  try {
    const content = SealedMessageContent.atDirectory(root);
    const message = { text: 'private answer', reasoning: 'private reasoning', toolCalls: [{ id: 'call', name: 'lookup', arguments: 'private tool arguments' }], unrelated: 'not content' };
    const reference = await content.seal('workspace', 'message', message);
    const other = await content.seal('other', 'message', message);
    const reopened = SealedMessageContent.atDirectory(root);
    expect(await reopened.read('workspace', 'message', reference)).toEqual({ text: message.text, reasoning: message.reasoning, toolCalls: message.toolCalls });
    const ciphertext = await new NodeFilesystemBlobStore(root).read(reference.reference.ciphertext.blobRef, reference.reference.ciphertext.digest);
    for (const value of [message.text, message.reasoning, message.toolCalls[0].arguments]) expect(Buffer.from(ciphertext).includes(Buffer.from(value))).toBe(false);
    await expect(reopened.read('workspace', 'other-message', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await expect(reopened.read('other', 'message', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await reopened.destroy('workspace', 'message', reference);
    await expect(content.read('workspace', 'message', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect((await reopened.read('other', 'message', other)).text).toBe(message.text);
    const empty = await content.seal('workspace', 'empty', { text: '' });
    expect(await content.read('workspace', 'empty', empty)).toEqual({ text: '' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
