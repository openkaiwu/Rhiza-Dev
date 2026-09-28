import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { ContextEnvelope } from '../execution-runtime/run';
import { SealedRunContent } from './sealed-run-content';
import { semanticStateChecksum } from './workspace-semantic-checksum';
import { NodeFilesystemBlobStore } from './node-host-runtime';

it('binds encrypted Run input to workspace, Run and semantic input hash across reopen and revocation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-sealed-run-'));
  try {
    const content = SealedRunContent.atDirectory(root);
    const input = {
      schemaVersion: '1.0.0', request: { requestId: 'run-one', prompt: 'sensitive input' },
      executor: { runtime: 'test', modelSpecRef: 'model', providerEndpointRef: 'endpoint', model: 'test', provider: 'test' },
    } as ContextEnvelope;
    const hash = semanticStateChecksum(input as unknown as Record<string, unknown>);
    await expect(content.seal('workspace', 'run', input, '0'.repeat(64))).rejects.toThrow('RUN_INPUT_HASH_MISMATCH');
    const reference = await content.seal('workspace', 'run', input, hash);
    const other = await content.seal('other', 'run', input, hash);
    const reopened = SealedRunContent.atDirectory(root);
    expect(await reopened.read('workspace', 'run', reference, hash)).toEqual(input);
    const ciphertext = await new NodeFilesystemBlobStore(root).read(reference.reference.ciphertext.blobRef, reference.reference.ciphertext.digest);
    expect(Buffer.from(ciphertext).includes(Buffer.from('sensitive input'))).toBe(false);
    await expect(reopened.read('workspace', 'wrong-run', reference, hash)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await expect(reopened.read('other', 'run', reference, hash)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await expect(reopened.read('workspace', 'run', reference, '0'.repeat(64))).rejects.toThrow('RUN_INPUT_HASH_MISMATCH');
    await reopened.destroy('workspace', 'run', reference);
    await expect(content.read('workspace', 'run', reference, hash)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect(await reopened.read('other', 'run', other, hash)).toEqual(input);
  } finally { await rm(root, { recursive: true, force: true }); }
});
