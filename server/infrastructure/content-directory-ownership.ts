import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Bind fresh directories only; legacy/shared directories require offline reconciliation. */
export class ContentDirectoryOwnership {
  private fingerprint?: Promise<string>;
  constructor(private readonly root: string, private readonly identity: string | (() => Promise<string>)) {}
  private expected() {
    return this.fingerprint ??= Promise.resolve(typeof this.identity === 'string' ? this.identity : this.identity())
      .then(identity => createHash('sha256').update(identity).digest('hex'));
  }
  async owns(): Promise<boolean> {
    const owner = await readFile(join(this.root, '.database-owner'), 'utf8').catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    const expected = await this.expected();
    if (owner !== undefined && owner !== expected) throw Object.assign(new Error('CONTENT_DIRECTORY_OWNER_MISMATCH'), { code: 'CONTENT_DIRECTORY_OWNER_MISMATCH' });
    return owner === expected;
  }
  async bindFresh(): Promise<void> {
    await mkdir(dirname(this.root), { recursive: true });
    const fresh = await mkdir(this.root, { mode: 0o700 }).then(() => true).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    });
    if (fresh) await writeFile(join(this.root, '.database-owner'), await this.expected(), { flag: 'wx', mode: 0o600 });
    else if (!(await this.owns())) {
      if (!(await readdir(this.root)).length) throw Object.assign(new Error('CONTENT_DIRECTORY_OWNER_UNVERIFIED'), { code: 'CONTENT_DIRECTORY_OWNER_UNVERIFIED' });
      // A competing fresh publisher must finish its owner marker before content.
      await this.owns();
    }
  }
}
