import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeFilesystemLegacyUpload } from './node-filesystem-legacy-upload';

let directory: string | undefined;

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('NodeFilesystemLegacyUpload', () => {
  it('stores bytes at the legacy attachment key under the upload directory', async () => {
    directory = await mkdtemp(join(tmpdir(), 'rhiza-upload-'));
    const upload = new NodeFilesystemLegacyUpload(directory);
    await upload.put('attachment-123', new Uint8Array([1, 2, 3]));
    await expect(readFile(join(directory, 'attachment-123'))).resolves.toEqual(Buffer.from([1, 2, 3]));
  });

  it('extracts text/plain with the host decoder', async () => {
    directory = await mkdtemp(join(tmpdir(), 'rhiza-upload-'));
    const upload = new NodeFilesystemLegacyUpload(directory);
    await expect(upload.extractText('text/plain', new TextEncoder().encode('Rhiza 文本'))).resolves.toBe('Rhiza 文本');
  });
});
