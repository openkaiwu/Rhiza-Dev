// @vitest-environment node
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { expect, it, vi } from 'vitest';
import { loadMigrations } from './migrate';
import { SealedContextItemContent } from '../server/infrastructure/sealed-context-item-content';
import { PostgresWorkspaceStore } from '../server/postgres-store';

it('rejects plaintext and malformed metadata in encrypted context item projections', async () => {
  const database = new PGlite();
  const root = await mkdtemp(join(tmpdir(), 'rhiza-context-sql-'));
  try {
    for (const migration of await loadMigrations()) await database.exec(migration.sql);
    const workspace = '00000000-0000-4000-8000-000000000001';
    await database.query("INSERT INTO rhiza_projects(id,title,state) VALUES ($1,'Test','{}')", [workspace]);
    await database.query("INSERT INTO rhiza_nodes(id,project_id,title,status,kind) VALUES ('00000000-0000-4000-8000-000000000002',$1,'Test','active','main')", [workspace]);
    const digest = 'a'.repeat(64);
    const contentRef = { format: 'rhiza.sealed-context-item.v1', contentId: 'content', reference: {
      version: 1, digest, size: 10, ciphertext: { digestAlgorithm: 'sha256', digest, blobRef: `sha256/aa/${digest}`, size: 39 },
    } };
    const item = { id: 'item', title: '', detail: '', role: 'Reference', status: 'active', tokens: 10, contentRef };
    const write = (value: unknown) => database.query('UPDATE rhiza_projects SET state=$2 WHERE id=$1', [workspace, JSON.stringify({ contextItems: [value] })]);
    await write(item);
    for (const patch of [{ title: 'private' }, { detail: 'private' }, { reason: '' }, { content: '' }, { extra: 'private' }, { contentRef: {} }, { contentRef: null }, { sourceId: { secret: true } }, { pinned: null }, { selectionMode: null }, { role: 'invalid' }]) {
      await expect(write({ ...item, ...patch })).rejects.toThrow();
    }
    await expect(database.exec(await readFile('db/migrations/0025_sealed_context_items.down.sql', 'utf8'))).rejects.toThrow('Cannot remove sealed context item protection');
    const content = SealedContextItemContent.atDirectory(root);
    const authored = { title: 'private title', detail: 'private detail', reason: 'private reason', content: 'private content' };
    const reference = await content.seal(workspace, item.id, authored);
    await write({ ...item, contentRef: reference });
    const store = new PostgresWorkspaceStore(database, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, content);
    const scoped = store.forWorkspace(workspace) as PostgresWorkspaceStore;
    const legacy = { id: item.id, role: item.role, status: item.status, tokens: item.tokens, ...authored };
    await write(legacy);
    const migrationSeal = vi.spyOn(content, 'seal');
    const decode = vi.spyOn(content, 'read').mockResolvedValueOnce({ title: 'wrong', detail: '' });
    await expect(scoped.sealLegacyContextItems(1)).rejects.toThrow('CONTEXT_ITEM_MIGRATION_CHECKSUM_MISMATCH');
    decode.mockRestore();
    await expect(content.read(workspace, item.id, await migrationSeal.mock.results[0].value)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect((await scoped.read()).contextItems).toEqual([legacy]);
    expect(await scoped.sealLegacyContextItems(1)).toBe(1);
    expect(await scoped.sealLegacyContextItems(1)).toBe(0);
    migrationSeal.mockRestore();
    const expected = [{ id: item.id, role: item.role, status: item.status, tokens: item.tokens, ...authored }];
    expect((await scoped.read()).contextItems).toEqual(expected);
    expect((await scoped.readConversationPreparation([])).contextItems).toEqual(expected);
    await expect(new PostgresWorkspaceStore(database, workspace).read()).rejects.toThrow('CONTEXT_ITEM_CONTENT_STORE_UNAVAILABLE');
    const seal = vi.spyOn(content, 'seal');
    await scoped.update(current => ({ ...current, contextItems: current.contextItems.map(entry => ({ ...entry, pinned: true })) }));
    expect(seal).not.toHaveBeenCalled();
    await scoped.update(current => ({ ...current, contextItems: current.contextItems.map(entry => ({ ...entry, title: 'updated title' })) }));
    expect(seal).toHaveBeenCalledOnce();
    const updated = await seal.mock.results[0].value;
    const stored = (await database.query<{ state: { contextItems: unknown[] } }>('SELECT state FROM rhiza_projects WHERE id=$1', [workspace])).rows[0].state;
    expect(stored.contextItems[0]).toMatchObject({ title: '', detail: '', contentRef: updated, pinned: true });
    expect(JSON.stringify(stored)).not.toContain('private');
    expect((await scoped.readConversationPreparation([])).contextItems[0].title).toBe('updated title');
    seal.mockClear();
    await database.exec("CREATE FUNCTION reject_project_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected project failure'; END $$; CREATE TRIGGER reject_project_write BEFORE INSERT ON rhiza_projects FOR EACH ROW EXECUTE FUNCTION reject_project_write();");
    await expect(scoped.update(current => ({ ...current, contextItems: current.contextItems.map(entry => ({ ...entry, title: 'failed title' })) }))).rejects.toThrow('injected project failure');
    await expect(content.read(workspace, item.id, await seal.mock.results[0].value)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect((await scoped.read()).contextItems[0].title).toBe('updated title');
    seal.mockRestore();
    await content.destroy(workspace, item.id, updated);
    await expect(scoped.read()).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await expect(scoped.readConversationPreparation([])).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await write({ id: 'legacy', title: 'legacy plaintext' });
    await database.exec(await readFile('db/migrations/0025_sealed_context_items.down.sql', 'utf8'));
  } finally { await database.close(); await rm(root, { recursive: true, force: true }); }
}, 30_000);
