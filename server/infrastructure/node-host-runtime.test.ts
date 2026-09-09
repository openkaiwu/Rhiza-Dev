import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { BlobIntegrityError, NodeFilesystemBlobStore, NodeHostRuntimeAdapter, type BlobCheckpoint } from './node-host-runtime';

const directories: string[] = [];
async function directory() { const path = await mkdtemp(join(tmpdir(), 'rhiza-blob-')); directories.push(path); return path; }
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('NodeFilesystemBlobStore', () => {
  it('computes generated stream identity before publication and cleans failed generators', async () => {
    const root = await directory();
    const store = new NodeFilesystemBlobStore(root);
    const bytes = Buffer.from('generated ciphertext');
    async function* chunks() { yield bytes.subarray(0, 4); yield bytes.subarray(4); }
    const result = await store.putStream(chunks(), undefined, bytes.length);
    expect(result.digest).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(await store.read(result.blobRef, result.digest)).toEqual(bytes);
    expect(await store.putStream(chunks(), undefined, bytes.length)).toEqual(result);
    await expect(store.putStream(chunks(), undefined, bytes.length - 1)).rejects.toThrow('size exceeds');
    await expect(store.putStream(chunks(), undefined, bytes.length + 1)).rejects.toThrow('size does not match');
    async function* failed() { yield bytes.subarray(0, 4); throw new Error('encryption failed'); }
    await expect(store.putStream(failed(), undefined, bytes.length)).rejects.toThrow('encryption failed');
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
  });
  it('streams declared bytes, rejects mismatch and cleans partial writes', async () => {
    const root = await directory();
    const store = new NodeFilesystemBlobStore(root);
    const bytes = Buffer.from('streamed blob');
    const digest = createHash('sha256').update(bytes).digest('hex');
    async function* chunks() { yield bytes.subarray(0, 3); yield bytes.subarray(3); }
    const result = await store.putStream(chunks(), digest, bytes.length);
    const emptyDigest = createHash('sha256').update('').digest('hex');
    const empty = await store.putStream((async function* () { yield new Uint8Array(); })(), emptyDigest, 0);
    expect(await store.read(empty.blobRef, emptyDigest)).toHaveLength(0);
    expect(Buffer.from(await store.read(result.blobRef, digest))).toEqual(bytes);
    await expect(store.putStream(chunks(), digest, bytes.length - 1)).rejects.toThrow('size exceeds');
    await expect(store.putStream(chunks(), digest, bytes.length + 1)).rejects.toThrow('size does not match');
    await expect(store.putStream(chunks(), 'a'.repeat(64), bytes.length)).rejects.toThrow('digest mismatch');
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
    await writeFile(join(root, 'blobs', ...result.blobRef.split('/')), 'corrupt');
    await expect(store.putStream(chunks(), digest, bytes.length)).rejects.toThrow('digest mismatch');
    expect(await readFile(join(root, 'blobs', ...result.blobRef.split('/')), 'utf8')).toBe('corrupt');
  });
  it('deduplicates concurrent content and verifies every read', async () => {
    const root = await directory();
    const store = new NodeFilesystemBlobStore(root);
    const bytes = new TextEncoder().encode('immutable resource');
    const [first, second] = await Promise.all([store.put(bytes), store.put(bytes)]);
    expect(first).toEqual(second);
    expect(new TextDecoder().decode(await store.read(first.blobRef, first.digest))).toBe('immutable resource');
    await writeFile(join(root, 'blobs', ...first.blobRef.split('/')), 'corrupt');
    await expect(store.read(first.blobRef, first.digest)).rejects.toBeInstanceOf(BlobIntegrityError);
  });

  it.each<BlobCheckpoint>(['temp-written', 'temp-verified', 'blob-promoted'])('can retry after a %s failure', async checkpoint => {
    const root = await directory();
    let failed = false;
    const store = new NodeFilesystemBlobStore(root, current => {
      if (!failed && current === checkpoint) { failed = true; throw new Error(`fault:${checkpoint}`); }
    });
    const bytes = new TextEncoder().encode(`retry ${checkpoint}`);
    await expect(store.put(bytes)).rejects.toThrow(`fault:${checkpoint}`);
    const recovered = await store.put(bytes);
    expect(new TextDecoder().decode(await store.read(recovered.blobRef, recovered.digest))).toBe(new TextDecoder().decode(bytes));
  });

  it('collects only unreferenced blobs after the grace period', async () => {
    const root = await directory();
    const store = new NodeFilesystemBlobStore(root);
    const active = await store.put(new TextEncoder().encode('active'));
    const orphan = await store.put(new TextEncoder().encode('orphan'));
    const result = await store.collectOrphans(new Set([active.blobRef]), 0, Date.now() + 1_000);
    expect(result).toEqual({ deleted: [orphan.blobRef], retained: [active.blobRef] });
    await expect(readFile(join(root, 'blobs', ...active.blobRef.split('/')))).resolves.toBeTruthy();
  });
});

describe('NodeHostRuntimeAdapter', () => {
  it('reports the V4.2 current-host contract and stable unavailable capabilities', async () => {
    const host = new NodeHostRuntimeAdapter(await directory());
    expect(host.describe()).toEqual({ host: 'node', fileAccess: 'available', pathNormalization: 'available', blobStorage: 'available', credentialAccess: 'degraded', spawn: 'unavailable', desktop: 'unavailable' });
    expect(host.normalizePath('workspace\\files/../brief.txt')).toBe('workspace/brief.txt');
    expect(() => host.normalizePath('../../escape')).toThrow('escapes');
    await expect(host.readCredential('AI_API_KEY')).resolves.toEqual({ state: 'degraded', reason: 'Credential adapter is not configured' });
  });
});
