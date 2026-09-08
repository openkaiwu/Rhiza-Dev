import { mkdtemp, rm, stat, truncate, unlink, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { NodeContentKeys } from './node-content-keys';
import { openContent, sealContent } from './sealed-content';

it('audits missing, revoked, incomplete and malformed keys without reading or changing keys', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-content-key-audit-'));
  try {
    const keys = new NodeContentKeys(root);
    const identities = ['live', 'candidate', 'revoked', 'incomplete', 'invalid', 'link', 'missing']
      .map(contentId => ({ workspaceId: 'workspace', contentId }));
    const [live, candidate, revoked, incomplete, invalid, link, missing] = identities;
    const original = await keys.create(live);
    for (const identity of [candidate, revoked, incomplete, invalid, link]) await keys.create(identity);
    const keyPath = async (identity: typeof live) => join(root, (await keys.audit([identity])).find(record => record.referenced)!.keyId, 'key');
    await keys.destroy(revoked);
    await unlink(await keyPath(incomplete));
    await truncate(await keyPath(invalid), 7);
    const linkPath = await keyPath(link);
    await unlink(linkPath);
    await symlink(await keyPath(live), linkPath);
    const records = await keys.audit([live, live, revoked, incomplete, invalid, link, missing]);
    expect(records).toHaveLength(7);
    expect(records.filter(record => !record.referenced)).toEqual([
      expect.objectContaining({ state: 'active', referenced: false }),
    ]);
    expect(records.filter(record => record.referenced).map(record => record.state).sort())
      .toEqual(['active', 'incomplete', 'invalid', 'invalid', 'missing', 'revoked']);
    expect(await keys.read(live)).toEqual(original);
    expect(await keys.read(candidate)).toHaveLength(32);
    expect(await keys.audit([live, revoked, incomplete, invalid, link, missing])).toEqual(records);
    const absentRoot = join(root, 'absent');
    expect(await new NodeContentKeys(absentRoot).audit([missing])).toEqual([
      expect.objectContaining({ referenced: true, state: 'missing' }),
    ]);
    await expect(stat(absentRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('persists scoped keys, destroys them idempotently and permanently reserves identities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-content-keys-'));
  try {
    const keys = new NodeContentKeys(root);
    const identity = { workspaceId: 'a', contentId: 'same' };
    const other = { workspaceId: 'b', contentId: 'same' };
    const key = await keys.create(identity);
    const otherKey = await keys.create(other);
    const sealed = sealContent(identity, Buffer.from('private content'), key);
    expect(openContent(identity, sealed, await new NodeContentKeys(root).read(identity))).toEqual(Buffer.from('private content'));
    await keys.destroy(identity);
    await keys.destroy(identity);
    await expect(new NodeContentKeys(root).read(identity)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await expect(keys.create(identity)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await keys.read(other)).toEqual(otherKey);
    const absent = { ...identity, contentId: 'never-created' };
    await keys.destroy(absent);
    await expect(keys.create(absent)).rejects.toMatchObject({ code: 'EEXIST' });
    const race = { ...identity, contentId: 'race' };
    const results = await Promise.allSettled([keys.create(race), keys.create(race)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const revokeRace = { ...identity, contentId: 'create-destroy-race' };
    const revocation = await Promise.allSettled([keys.create(revokeRace), keys.destroy(revokeRace)]);
    expect(revocation[1].status).toBe('fulfilled');
    await expect(keys.read(revokeRace)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await expect(keys.create(revokeRace)).rejects.toMatchObject({ code: 'EEXIST' });
    expect((await stat(root)).mode & 0o077).toBe(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
