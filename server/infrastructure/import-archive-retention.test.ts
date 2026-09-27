// @vitest-environment node
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
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

  it('cleans an uploaded plaintext file left by a SIGKILLed import process', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-interrupted-import-'));
    const root = join(directory, 'imports');
    const transient = join(root, 'transient');
    const bytes = Buffer.from('interrupted private upload');
    const moduleUrl = pathToFileURL(join(import.meta.dirname, 'node-bundle-import.ts')).href;
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      `import { NodeBundleImport } from ${JSON.stringify(moduleUrl)};
       new NodeBundleImport(process.argv[1], {}).receive((async function* () {
         yield Buffer.from(${JSON.stringify(bytes.toString())});
         await new Promise(() => setInterval(() => {}, 1000));
       })());`, root], { cwd: resolve(import.meta.dirname, '../..'), stdio: 'ignore' });
    try {
      await vi.waitFor(async () => {
        const uploads = (await readdir(transient)).filter(name => name.startsWith('rhiza-bundle-upload-'));
        expect(uploads).toHaveLength(1);
        expect(await readFile(join(transient, uploads[0], 'archive.rhiza'))).toEqual(bytes);
      }, { timeout: 10_000, interval: 100 });
      const exited = once(child, 'exit');
      expect(child.kill('SIGKILL')).toBe(true);
      expect(await exited).toEqual([null, 'SIGKILL']);
      await new NodeImportArchiveStore(root).reclaim(new Set(), 0);
      expect(await readdir(transient)).toEqual([]);
    } finally {
      child.kill('SIGKILL');
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('resumes after SIGKILL between archive key destruction and descriptor removal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-retained-reclaim-'));
    let child: ReturnType<typeof spawn> | undefined;
    try {
      const bytes = Buffer.from('archive reclaim interruption');
      const digest = createHash('sha256').update(bytes).digest('hex');
      const source = join(directory, 'source.rhiza');
      const root = join(directory, 'imports');
      await writeFile(source, bytes);
      const store = new NodeImportArchiveStore(root);
      await store.retain(source, digest);
      const descriptorPath = join(root, 'retained', `${digest}.json`);
      const moduleUrl = pathToFileURL(join(import.meta.dirname, 'portable-content.ts')).href;
      child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
        `import { NodeImportArchiveStore } from ${JSON.stringify(moduleUrl)};
         const store = new NodeImportArchiveStore(process.argv[1]);
         const content = Reflect.get(store, 'content');
         const destroy = content.destroy.bind(content);
         content.destroy = async identity => { await destroy(identity); process.kill(process.pid, 'SIGKILL'); };
         await store.reclaim(new Set(), 0, Date.now() + 1000);`, root],
      { cwd: resolve(import.meta.dirname, '../..'), stdio: 'ignore' });
      expect(await once(child, 'exit')).toEqual([null, 'SIGKILL']);
      const future = Date.now() + 1000;
      expect((await stat(descriptorPath)).isFile()).toBe(true);
      await expect(store.stage(digest)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
      expect(await store.reclaim(new Set(), 0, future)).toMatchObject({ released: 1, retained: 0 });
      await expect(stat(descriptorPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { child?.kill('SIGKILL'); await rm(directory, { recursive: true, force: true }); }
  }, 15_000);
});
