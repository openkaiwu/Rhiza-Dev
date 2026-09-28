// @vitest-environment node
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { expect, it, vi } from 'vitest';
import { loadMigrations } from './migrate';
import { SealedAttachmentContent } from '../server/infrastructure/sealed-attachment-content';
import { PostgresWorkspaceStore } from '../server/postgres-store';

it('rejects plaintext beside attachment ciphertext and prevents unsafe downgrade', async () => {
  const database = new PGlite();
  const root = await mkdtemp(join(tmpdir(), 'rhiza-attachment-sql-'));
  try {
    for (const migration of await loadMigrations()) await database.exec(migration.sql);
    const workspace = '00000000-0000-4000-8000-000000000001';
    await database.query("INSERT INTO rhiza_projects(id,title,state) VALUES ($1,'Test','{}')", [workspace]);
    await database.query("INSERT INTO rhiza_nodes(id,project_id,title,status,kind) VALUES ('00000000-0000-4000-8000-000000000003',$1,'Test','active','main')", [workspace]);
    await database.query("INSERT INTO rhiza_attachments(id,project_id,name,mime_type,size_bytes,kind,storage_key) VALUES ('00000000-0000-4000-8000-000000000002',$1,'legacy','text/plain',10,'file','blob')", [workspace]);
    const digest = 'a'.repeat(64);
    const reference = { format: 'rhiza.sealed-attachment.v1', contentId: 'content', reference: {
      version: 1, digest, size: 10, ciphertext: { digestAlgorithm: 'sha256', digest, blobRef: `sha256/aa/${digest}`, size: 39 },
    } };
    const write = (ref: unknown, name = '[sealed]', text: string | null = null, summary: string | null = null) => database.query('UPDATE rhiza_attachments SET content_ref=$1::jsonb,name=$2,extracted_text=$3,summary=$4', [JSON.stringify(ref), name, text, summary]);
    await write(reference);
    await expect(write(reference, 'private')).rejects.toThrow();
    await expect(write(reference, '[sealed]', 'private')).rejects.toThrow();
    await expect(write(reference, '[sealed]', null, 'private')).rejects.toThrow();
    for (const invalid of [null, {}, { ...reference, extra: 'private' }, { ...reference, contentId: '' }, { ...reference, reference: { ...reference.reference, size: -1 } }]) {
      await expect(write(invalid)).rejects.toThrow();
    }
    const down = await readFile('db/migrations/0027_sealed_attachment_content.down.sql', 'utf8');
    await expect(database.exec(down)).rejects.toThrow('Cannot remove sealed attachment references');
    const content = SealedAttachmentContent.atDirectory(root);
    const id = '00000000-0000-4000-8000-000000000002';
    const authored = { name: 'private.txt', extractedText: 'private text', summary: 'private summary' };
    const ref = await content.seal(workspace, id, authored);
    await write(ref);
    const store = new PostgresWorkspaceStore(database, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, content).forWorkspace(workspace) as PostgresWorkspaceStore;
    expect((await store.read()).attachments[0]).toMatchObject(authored);
    expect((await store.readConversationPreparation([id])).attachments[0]).toMatchObject(authored);
    await database.query('UPDATE rhiza_attachments SET content_ref=NULL,name=$1,extracted_text=$2,summary=$3', [authored.name, authored.extractedText, authored.summary]);
    const migrationSeal = vi.spyOn(content, 'seal');
    const decode = vi.spyOn(content, 'read').mockResolvedValueOnce({ name: 'wrong' });
    await expect(store.sealLegacyAttachmentContent(1)).rejects.toThrow('ATTACHMENT_MIGRATION_CHECKSUM_MISMATCH');
    decode.mockRestore();
    await expect(content.read(workspace, id, await migrationSeal.mock.results[0].value)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect((await store.read()).attachments[0]).toMatchObject(authored);
    await expect(store.sealLegacyAttachmentContent(0)).rejects.toThrow('INVALID_ATTACHMENT_MIGRATION_LIMIT');
    expect(await store.sealLegacyAttachmentContent(1)).toBe(1);
    expect(await store.sealLegacyAttachmentContent(1)).toBe(0);
    expect((await store.readConversationPreparation([id])).attachments[0]).toMatchObject(authored);
    migrationSeal.mockRestore();
    await expect(new PostgresWorkspaceStore(database, workspace).read()).rejects.toThrow('ATTACHMENT_CONTENT_STORE_UNAVAILABLE');
    const seal = vi.spyOn(content, 'seal');
    await store.update(current => ({ ...current, attachments: current.attachments.map(item => ({ ...item, name: 'updated.txt' })) }));
    expect(seal).toHaveBeenCalledOnce();
    const updated = await seal.mock.results[0].value;
    expect((await store.read()).attachments[0].name).toBe('updated.txt');
    expect((await database.query('SELECT name,extracted_text,summary,content_ref FROM rhiza_attachments')).rows[0]).toEqual({ name: '[sealed]', extracted_text: null, summary: null, content_ref: updated });
    seal.mockClear();
    await database.exec("CREATE FUNCTION reject_attachment_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected attachment failure'; END $$; CREATE TRIGGER reject_attachment_write BEFORE INSERT ON rhiza_attachments FOR EACH ROW EXECUTE FUNCTION reject_attachment_write();");
    await expect(store.update(current => ({ ...current, attachments: current.attachments.map(item => ({ ...item, name: 'failed.txt' })) }))).rejects.toThrow('injected attachment failure');
    await expect(content.read(workspace, id, await seal.mock.results[0].value)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect((await store.readConversationPreparation([id])).attachments[0].name).toBe('updated.txt');
    seal.mockRestore();
    await content.destroy(workspace, id, updated);
    await expect(store.read()).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await expect(store.readConversationPreparation([id])).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await database.exec("UPDATE rhiza_attachments SET content_ref=NULL,name='legacy',extracted_text='restored'");
    await database.exec(down);
  } finally { await database.close(); await rm(root, { recursive: true, force: true }); }
}, 30_000);
