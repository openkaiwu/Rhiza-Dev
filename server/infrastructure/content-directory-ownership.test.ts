import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { ContentDirectoryOwnership } from './content-directory-ownership';

it('binds a fresh directory, rejects another database and never claims a legacy directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-content-owner-'));
  try {
    const directory = join(root, 'new');
    const first = new ContentDirectoryOwnership(directory, 'database-a');
    await first.bindFresh();
    await first.bindFresh();
    expect(await first.owns()).toBe(true);
    await expect(new ContentDirectoryOwnership(directory, 'database-b').bindFresh()).rejects.toMatchObject({ code: 'CONTENT_DIRECTORY_OWNER_MISMATCH' });
    expect(await first.owns()).toBe(true);
    const legacy = join(root, 'legacy');
    await mkdir(legacy);
    await writeFile(join(legacy, 'original'), 'preserved');
    const unknown = new ContentDirectoryOwnership(legacy, 'database-a');
    await unknown.bindFresh();
    expect(await unknown.owns()).toBe(false);
    expect(await readFile(join(legacy, 'original'), 'utf8')).toBe('preserved');
    await expect(readFile(join(legacy, '.database-owner'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('rechecks an owner published after the initial unclaimed-directory read', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-content-owner-race-'));
  try {
    const first = new ContentDirectoryOwnership(join(root, 'content'), 'database-a');
    await first.bindFresh();
    const second = new ContentDirectoryOwnership(join(root, 'content'), 'database-b');
    vi.spyOn(second, 'owns').mockResolvedValueOnce(false);
    await expect(second.bindFresh()).rejects.toMatchObject({ code: 'CONTENT_DIRECTORY_OWNER_MISMATCH' });
    expect(await first.owns()).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
