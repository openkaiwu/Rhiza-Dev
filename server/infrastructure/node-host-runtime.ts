import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, mkdir, open, readFile, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, posix, resolve, sep } from 'node:path';
import type { BlobGcResult, BlobPutResult, BlobStorePort, HostCapabilityDescriptor, HostCredentialResult, HostRuntimePort } from '../application/ports/host-runtime';

export type BlobCheckpoint = 'temp-written' | 'temp-verified' | 'blob-promoted';

export class BlobIntegrityError extends Error {
  constructor(message: string, readonly reason: 'missing_blob' | 'digest_mismatch' = 'digest_mismatch') { super(message); }
  readonly code = 'BLOB_INTEGRITY_ERROR';
  readonly status = 409;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertDigest(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new BlobIntegrityError('Invalid SHA-256 digest');
}

function blobRefFor(digest: string): string {
  assertDigest(digest);
  return `sha256/${digest.slice(0, 2)}/${digest}`;
}

export class NodeFilesystemBlobStore implements BlobStorePort {
  constructor(
    private readonly root: string,
    private readonly checkpoint?: (checkpoint: BlobCheckpoint) => void | Promise<void>,
  ) {}

  private pathFor(blobRef: string): string {
    if (!/^sha256\/[a-f0-9]{2}\/[a-f0-9]{64}$/.test(blobRef)) throw new BlobIntegrityError('Invalid blob reference');
    const path = resolve(this.root, 'blobs', ...blobRef.split('/'));
    const base = `${resolve(this.root, 'blobs')}${sep}`;
    if (!path.startsWith(base)) throw new BlobIntegrityError('Blob reference escapes the store');
    return path;
  }

  async put(bytes: Uint8Array): Promise<BlobPutResult> {
    if (!bytes.length) throw new BlobIntegrityError('Blob content is empty');
    return this.putStream((async function* () { yield bytes; })(), sha256(bytes), bytes.length);
  }

  // Generated ciphertext has no digest until encryption finishes; hash the staged file before publication.
  async putStream(bytes: AsyncIterable<Uint8Array>, expectedDigest: string | undefined, expectedSize: number): Promise<BlobPutResult> {
    if (expectedDigest !== undefined) assertDigest(expectedDigest);
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) throw new BlobIntegrityError('Invalid blob size');
    const temporary = resolve(this.root, 'tmp', `${randomUUID()}.tmp`);
    await mkdir(dirname(temporary), { recursive: true });
    try {
      const handle = await open(temporary, 'wx', 0o600);
      let size = 0;
      try {
        for await (const chunk of bytes) {
          size += chunk.length;
          if (size > expectedSize) throw new BlobIntegrityError('Blob size exceeds declaration');
          await handle.writeFile(chunk);
        }
        if (size !== expectedSize) throw new BlobIntegrityError('Blob size does not match declaration');
        await handle.sync();
      } finally { await handle.close(); }
      await this.checkpoint?.('temp-written');
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(temporary)) hash.update(chunk);
      const digest = hash.digest('hex');
      if (expectedDigest !== undefined && digest !== expectedDigest) throw new BlobIntegrityError('Temporary blob digest mismatch');
      const blobRef = blobRefFor(digest);
      const target = this.pathFor(blobRef);
      await this.checkpoint?.('temp-verified');
      await mkdir(dirname(target), { recursive: true });
      try { await link(temporary, target); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        // Consume the entire verified stream; an existing corrupt object is never overwritten.
        for await (const chunk of this.readStream(blobRef, digest)) void chunk;
      }
      const parent = await open(dirname(target), 'r');
      try { await parent.sync(); } finally { await parent.close(); }
      await this.checkpoint?.('blob-promoted');
      return { digestAlgorithm: 'sha256', digest, blobRef, size };
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async read(blobRef: string, expectedDigest: string): Promise<Uint8Array> {
    assertDigest(expectedDigest);
    if (blobRef !== blobRefFor(expectedDigest)) throw new BlobIntegrityError('Blob reference does not match digest');
    let bytes: Uint8Array;
    try { bytes = await readFile(this.pathFor(blobRef)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new BlobIntegrityError('Referenced blob is missing', 'missing_blob');
      throw error;
    }
    if (sha256(bytes) !== expectedDigest) throw new BlobIntegrityError('Stored blob digest mismatch');
    return bytes;
  }

  async *readStream(blobRef: string, expectedDigest: string): AsyncIterable<Uint8Array> {
    assertDigest(expectedDigest);
    if (blobRef !== blobRefFor(expectedDigest)) throw new BlobIntegrityError('Blob reference does not match digest');
    const hash = createHash('sha256');
    try {
      for await (const bytes of createReadStream(this.pathFor(blobRef))) { hash.update(bytes); yield bytes; }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new BlobIntegrityError('Referenced blob is missing', 'missing_blob');
      throw error;
    }
    if (hash.digest('hex') !== expectedDigest) throw new BlobIntegrityError('Stored blob digest mismatch');
  }

  async collectOrphans(referencedBlobRefs: ReadonlySet<string>, gracePeriodMs: number, now = Date.now()): Promise<BlobGcResult> {
    const base = resolve(this.root, 'blobs', 'sha256');
    const deleted: string[] = [];
    const retained: string[] = [];
    let prefixes: string[] = [];
    try { prefixes = await readdir(base); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    for (const prefix of prefixes) {
      let names: string[];
      try { names = await readdir(join(base, prefix)); } catch { continue; }
      for (const name of names) {
        const blobRef = `sha256/${prefix}/${name}`;
        const path = join(base, prefix, name);
        if (referencedBlobRefs.has(blobRef) || now - (await stat(path)).mtimeMs < gracePeriodMs) retained.push(blobRef);
        else { await rm(path, { force: true }); deleted.push(blobRef); }
      }
    }
    const temporaryRoot = resolve(this.root, 'tmp');
    let temporaryNames: string[] = [];
    try { temporaryNames = await readdir(temporaryRoot); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    for (const name of temporaryNames) {
      const path = join(temporaryRoot, name);
      const ref = `tmp/${name}`;
      if (now - (await stat(path)).mtimeMs < gracePeriodMs) retained.push(ref);
      else { await rm(path, { force: true }); deleted.push(ref); }
    }
    return { deleted, retained };
  }
}

export class NodeHostRuntimeAdapter implements HostRuntimePort {
  readonly blobs: BlobStorePort;
  constructor(
    private readonly root: string,
    options: { checkpoint?: (checkpoint: BlobCheckpoint) => void | Promise<void>; credential?: (name: string) => Promise<string | undefined>; blobs?: BlobStorePort } = {},
  ) {
    this.blobs = options.blobs ?? new NodeFilesystemBlobStore(root, options.checkpoint);
    this.credential = options.credential;
  }
  private readonly credential?: (name: string) => Promise<string | undefined>;

  describe(): HostCapabilityDescriptor {
    return { host: 'node', fileAccess: 'available', pathNormalization: 'available', blobStorage: 'available', credentialAccess: this.credential ? 'available' : 'degraded', spawn: 'unavailable', desktop: 'unavailable' };
  }

  normalizePath(path: string): string {
    const normalized = posix.normalize(path.replaceAll('\\', '/'));
    if (normalized === '..' || normalized.startsWith('../')) throw new Error('Path escapes the host scope');
    return normalized;
  }

  async readCredential(name: string): Promise<HostCredentialResult> {
    if (!this.credential) return { state: 'degraded', reason: 'Credential adapter is not configured' };
    const value = await this.credential(name);
    return value ? { state: 'available', value } : { state: 'unavailable', reason: `Credential ${name} is unavailable` };
  }

  async readLegacyAttachment(key: string): Promise<Uint8Array> {
    if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error('Invalid legacy attachment key');
    return readFile(resolve(this.root, key));
  }
}
