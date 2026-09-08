import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { SealedJournalContent } from './sealed-journal-content';
import { NodeFilesystemBlobStore } from './node-host-runtime';

it('preserves baseline and state changes while binding payload keys to event and workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-journal-content-'));
  try {
    const content = SealedJournalContent.atDirectory(root);
    const payload = { snapshot: { state: { messages: [{ text: 'historical private message' }] } }, stateChanges: { projectTitle: 'private title' }, reconcileChecksum: 'checksum' };
    const reference = await content.seal('workspace', 'event', payload);
    const other = await content.seal('other', 'event', payload);
    const reopened = SealedJournalContent.atDirectory(root);
    expect(await reopened.read('workspace', 'event', reference)).toEqual(payload);
    const ciphertext = await new NodeFilesystemBlobStore(root).read(reference.reference.ciphertext.blobRef, reference.reference.ciphertext.digest);
    expect(Buffer.from(ciphertext).includes(Buffer.from('historical private message'))).toBe(false);
    await expect(reopened.read('workspace', 'different-event', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await expect(reopened.read('other', 'event', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await reopened.destroy('workspace', 'event', reference);
    await expect(content.read('workspace', 'event', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect(await reopened.read('other', 'event', other)).toEqual(payload);
  } finally { await rm(root, { recursive: true, force: true }); }
});
