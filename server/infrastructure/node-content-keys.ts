import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ContentIdentity } from './sealed-content';

async function syncDirectory(path: string) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

/** Local data keys. Reserved identities survive destruction and must never be reused. */
export class NodeContentKeys {
  constructor(private readonly root: string) {}

  private keyId(identity: ContentIdentity) {
    if (!identity.workspaceId || !identity.contentId) throw new Error('CONTENT_IDENTITY_REQUIRED');
    return createHash('sha256').update(JSON.stringify([identity.workspaceId, identity.contentId])).digest('hex');
  }

  private directory(identity: ContentIdentity) {
    return join(this.root, this.keyId(identity));
  }

  /** Point-in-time metadata only. Unreferenced keys may belong to in-flight commits. */
  async audit(liveIdentities: Iterable<ContentIdentity>) {
    const expected = new Set(Array.from(liveIdentities, identity => this.keyId(identity)));
    const entries = await readdir(this.root, { withFileTypes: true }).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    const records: Array<{ keyId: string; referenced: boolean; state: 'active' | 'revoked' | 'incomplete' | 'invalid' | 'missing' }> = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!/^[a-f0-9]{64}$/.test(entry.name)) continue;
      const referenced = expected.delete(entry.name);
      let state: typeof records[number]['state'] = 'invalid';
      if (entry.isDirectory()) {
        const metadata = await lstat(join(this.root, entry.name, 'key')).catch(error => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
          throw error;
        });
        if (!metadata) state = 'incomplete';
        else if (metadata.isFile()) state = metadata.size === 32 ? 'active' : metadata.size === 0 ? 'revoked' : 'invalid';
      }
      records.push({ keyId: entry.name, referenced, state });
    }
    for (const keyId of [...expected].sort()) records.push({ keyId, referenced: true, state: 'missing' });
    return records;
  }

  async create(identity: ContentIdentity): Promise<Buffer> {
    const directory = this.directory(identity);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    // Exclusive reservation also prevents recreation after a crash or destruction.
    await mkdir(directory, { mode: 0o700 });
    await syncDirectory(this.root);
    const key = randomBytes(32);
    const handle = await open(join(directory, 'key'), 'wx', 0o600);
    try { await handle.writeFile(key); await handle.sync(); } finally { await handle.close(); }
    await syncDirectory(directory);
    return key;
  }

  async read(identity: ContentIdentity): Promise<Buffer> {
    try {
      const key = await readFile(join(this.directory(identity), 'key'));
      if (key.length !== 32) throw new Error('CONTENT_KEY_UNAVAILABLE');
      return key;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('CONTENT_KEY_UNAVAILABLE', { cause: error });
      throw error;
    }
  }

  async destroy(identity: ContentIdentity): Promise<void> {
    const directory = this.directory(identity);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await syncDirectory(this.root);
    const temporary = join(directory, `revoked-${randomUUID()}`);
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.sync(); } finally { await handle.close(); }
      // Atomically replace the key with a durable empty tombstone. A concurrent
      // creator either fails exclusive open or writes an already-unlinked inode.
      await rename(temporary, join(directory, 'key'));
      await syncDirectory(directory);
    } finally { await rm(temporary, { force: true }); }
  }
}
