import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { NodeContentKeys } from './node-content-keys';
import { openContent, sealContent } from './sealed-content';

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
