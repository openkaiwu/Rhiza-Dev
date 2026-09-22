// @vitest-environment node
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { expect, it, vi } from 'vitest';
import { loadMigrations } from './migrate';
import { SealedResourceContent } from '../server/infrastructure/sealed-resource-content';
import { PostgresWorkspaceStore } from '../server/postgres-store';
import { NodeFilesystemBlobStore } from '../server/infrastructure/node-host-runtime';
import { NodeContentKeys } from '../server/infrastructure/node-content-keys';
import { NodeSealedContentStore } from '../server/infrastructure/node-sealed-content-store';
import { NodeEncryptedBlobStore } from '../server/infrastructure/node-encrypted-blob-store';

it('protects sealed resource names and refuses unsafe downgrade', async () => {
  const database = new PGlite();
  const root = await mkdtemp(join(tmpdir(), 'rhiza-resource-sql-'));
  try {
    for (const migration of await loadMigrations()) await database.exec(migration.sql);
    const workspace = '00000000-0000-4000-8000-000000000001';
    await database.query("INSERT INTO rhiza_projects(id,title,state) VALUES ($1,'Test','{}')", [workspace]);
    await database.query("INSERT INTO rhiza_nodes(id,project_id,title,status,kind) VALUES ('00000000-0000-4000-8000-000000000002',$1,'Test','active','main')", [workspace]);
    await database.query("INSERT INTO rhiza_resources(resource_id,workspace_id,kind,logical_name) VALUES ('resource',$1,'attachment','legacy')", [workspace]);
    const digest = 'a'.repeat(64);
    const reference = { format: 'rhiza.sealed-resource.v1', contentId: 'content', reference: {
      version: 1, digest, size: 10, ciphertext: { digestAlgorithm: 'sha256', digest, blobRef: `sha256/aa/${digest}`, size: 39 },
    } };
    const write = (ref: unknown, name = '[sealed]') => database.query("UPDATE rhiza_resources SET content_ref=$1::jsonb,logical_name=$2 WHERE resource_id='resource'", [JSON.stringify(ref), name]);
    await write(reference);
    await expect(write(reference, 'private')).rejects.toThrow();
    for (const invalid of [null, {}, { ...reference, extra: 'private' }, { ...reference, contentId: '' }, { ...reference, reference: { ...reference.reference, size: -1 } }]) await expect(write(invalid)).rejects.toThrow();
    const down = await readFile('db/migrations/0028_sealed_resource_content.down.sql', 'utf8');
    await expect(database.exec(down)).rejects.toThrow('Cannot remove sealed resource references');
    const content = SealedResourceContent.atDirectory(root);
    const ref = await content.seal(workspace, 'resource', { logicalName: 'private name' });
    await write(ref);
    const store = new PostgresWorkspaceStore(database, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, content).forWorkspace(workspace) as PostgresWorkspaceStore;
    expect((await store.read()).resources[0]).toMatchObject({ id: 'resource', logicalName: 'private name' });
    await database.exec("UPDATE rhiza_resources SET content_ref=NULL,logical_name='private name'");
    const migrationSeal = vi.spyOn(content, 'seal');
    const decode = vi.spyOn(content, 'read').mockResolvedValueOnce({ logicalName: 'wrong' });
    await expect(store.sealLegacyResourceContent(1)).rejects.toThrow('RESOURCE_MIGRATION_CHECKSUM_MISMATCH');
    decode.mockRestore();
    await expect(content.read(workspace, 'resource', await migrationSeal.mock.results[0].value)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect((await store.read()).resources[0].logicalName).toBe('private name');
    expect(await store.sealLegacyResourceContent(1)).toBe(1);
    expect(await store.sealLegacyResourceContent(1)).toBe(0);
    await expect(store.sealLegacyResourceContent(0)).rejects.toThrow('INVALID_RESOURCE_MIGRATION_LIMIT');
    expect((await store.read()).resources[0].logicalName).toBe('private name');
    migrationSeal.mockRestore();
    const rawBlobs = new NodeFilesystemBlobStore(join(root, 'resource-blobs'));
    const encryptedBlobs = new NodeEncryptedBlobStore(new NodeSealedContentStore(
      rawBlobs,
      new NodeContentKeys(join(root, 'resource-blob-keys')),
    ), rawBlobs);
    const raw = await rawBlobs.put(new TextEncoder().encode('legacy resource bytes'));
    await database.query("INSERT INTO rhiza_resources(resource_id,workspace_id,kind,logical_name) VALUES ('blob-resource',$1,'attachment','blob')", [workspace]);
    await database.query("INSERT INTO rhiza_resource_versions(resource_version_id,resource_id,version,digest_algorithm,digest,canonicalization,media_type,size_bytes,blob_ref) VALUES ('blob-version','blob-resource',1,'sha256',$1,'raw-v1','text/plain',$2,$3)", [raw.digest, raw.size, raw.blobRef]);
    expect(await store.sealLegacyResourceBlobs(rawBlobs, encryptedBlobs, 1)).toBe(1);
    expect(await store.sealLegacyResourceBlobs(rawBlobs, encryptedBlobs, 1)).toBe(0);
    const migratedBlob = (await database.query<{ blob_ref: string }>("SELECT blob_ref FROM rhiza_resource_versions WHERE resource_version_id='blob-version'")).rows[0].blob_ref;
    expect(migratedBlob).toMatch(/^sealed-v1\//);
    expect(new TextDecoder().decode(await encryptedBlobs.read(migratedBlob, raw.digest))).toBe('legacy resource bytes');
    await expect(store.sealLegacyResourceBlobs(rawBlobs, encryptedBlobs, 0)).rejects.toThrow('INVALID_RESOURCE_BLOB_MIGRATION_LIMIT');
    await write(ref);
    const seal = vi.spyOn(content, 'seal');
    const manifestId = '00000000-0000-4000-8000-000000000010';
    await database.query("INSERT INTO rhiza_resource_versions(resource_version_id,resource_id,version,digest_algorithm,digest,canonicalization,media_type,size_bytes,blob_ref) VALUES ('version','resource',1,'sha256',$1,'raw-v1','text/plain',10,$2)", [digest, `sha256/aa/${digest}`]);
    const manifest = { schemaVersion: '1.0.0', versions: { planner: '1', compiler: '1', tokenizer: '1', selectionPolicy: '1', contributors: { node: '1' } }, contextItems: [{ resourceId: 'resource', resourceVersionId: 'version', digest, contributorVersion: '1', reason: 'selected', selectionMode: 'AUTO_RETRIEVED', priority: 1 }] };
    await database.query("INSERT INTO rhiza_context_manifests(id,project_id,node_id,request_id,mode,provider,model,runtime,manifest) VALUES ($1,$2,'00000000-0000-4000-8000-000000000002',$1,'Auto','test','test','test',$3)", [manifestId, workspace, JSON.stringify(manifest)]);
    const history = await store.readContextHistory({ manifestId });
    expect(history?.resources[0]).toMatchObject({ id: 'resource', logicalName: 'private name' });
    expect(history?.versions[0]).toMatchObject({ id: 'version', resourceId: 'resource', digest });
    const added = { id: 'new-resource', workspaceId: workspace, kind: 'attachment' as const, logicalName: 'new private name', createdAt: new Date().toISOString() };
    await store.update(current => ({ ...current, resources: [...current.resources, added] }));
    expect(seal).toHaveBeenCalledOnce();
    expect((await store.read()).resources).toEqual(expect.arrayContaining([added]));
    expect((await database.query("SELECT logical_name,content_ref FROM rhiza_resources WHERE resource_id='new-resource'")).rows[0]).toMatchObject({ logical_name: '[sealed]', content_ref: await seal.mock.results[0].value });
    seal.mockClear();
    await store.update(current => ({ ...current, resources: current.resources.map(item => ({ ...item, logicalName: 'ignored' })) }));
    expect(seal).not.toHaveBeenCalled();
    expect((await store.read()).resources).toEqual(expect.arrayContaining([added]));
    await database.exec("CREATE FUNCTION compete_resource_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO rhiza_resources(resource_id,workspace_id,kind,logical_name) VALUES (NEW.resource_id,NEW.workspace_id,NEW.kind,'winning name'); RETURN NEW; END $$; CREATE TRIGGER compete_resource_write BEFORE INSERT ON rhiza_resources FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION compete_resource_write();");
    seal.mockClear();
    await store.update(current => ({ ...current, resources: [...current.resources, { ...added, id: 'competing-resource' }] }));
    expect(seal).toHaveBeenCalledOnce();
    await expect(content.read(workspace, 'competing-resource', await seal.mock.results[0].value)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect((await store.read()).resources.find(item => item.id === 'competing-resource')?.logicalName).toBe('winning name');
    await database.exec('DROP TRIGGER compete_resource_write ON rhiza_resources; DROP FUNCTION compete_resource_write();');
    seal.mockClear();
    await database.exec("CREATE FUNCTION reject_resource_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected resource failure'; END $$; CREATE TRIGGER reject_resource_write BEFORE INSERT ON rhiza_resources FOR EACH ROW EXECUTE FUNCTION reject_resource_write();");
    await expect(store.update(current => ({ ...current, resources: [...current.resources, { ...added, id: 'failed-resource' }] }))).rejects.toThrow('injected resource failure');
    await expect(content.read(workspace, 'failed-resource', await seal.mock.results[0].value)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    seal.mockRestore();
    await expect(new PostgresWorkspaceStore(database, workspace).read()).rejects.toThrow('RESOURCE_CONTENT_STORE_UNAVAILABLE');
    await content.destroy(workspace, 'resource', ref);
    await expect(store.read()).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await expect(store.readContextHistory({ manifestId })).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await database.exec("UPDATE rhiza_resources SET content_ref=NULL,logical_name='restored'");
    await database.exec(down);
  } finally { await database.close(); await rm(root, { recursive: true, force: true }); }
}, 30_000);
