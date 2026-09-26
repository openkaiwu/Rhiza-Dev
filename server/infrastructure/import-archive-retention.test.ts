// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NodeImportArchiveStore } from './portable-content';

describe('retained import archive encryption and recovery window', () => {
  it('retains only ciphertext, honors a checkpoint pin, then destroys the key and reclaims the archive', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-retained-archive-'));
    try {
      const bytes = Buffer.from('private import archive recovery bytes');
      const digest = createHash('sha256').update(bytes).digest('hex');
      const source = join(directory, 'source.rhiza');
      const root = join(directory, 'imports');
      await writeFile(source, bytes);
      const store = new NodeImportArchiveStore(root);
      await store.retain(source, digest);
      const abandoned = join(root, 'transient', 'rhiza-bundle-stage-abandoned');
      const unrelated = join(root, 'transient', 'operator-files');
      await mkdir(abandoned, { recursive: true });
      await mkdir(unrelated);
      await writeFile(join(abandoned, 'plaintext'), bytes);
      const descriptorPath = join(root, 'retained', `${digest}.json`);
      const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8')) as { reference: { ciphertext: { blobRef: string } } };
      const encryptedPath = join(root, 'blobs', ...descriptor.reference.ciphertext.blobRef.split('/'));
      expect((await readFile(encryptedPath)).includes(bytes)).toBe(false);

      const future = Date.now() + 1000;
      expect(await store.reclaim(new Set([digest]), 0, future)).toMatchObject({ released: 0, retained: 1 });
      await expect(stat(abandoned)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await stat(unrelated)).isDirectory()).toBe(true);
      expect(await store.reclaim(new Set(), 0, future)).toMatchObject({ released: 1, retained: 0 });
      await expect(stat(descriptorPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(encryptedPath)).rejects.toMatchObject({ code: 'ENOENT' });

      // A later import of identical bytes receives a fresh key identity.
      await store.retain(source, digest);
      expect(JSON.parse(await readFile(descriptorPath, 'utf8'))).toHaveProperty('contentId');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
