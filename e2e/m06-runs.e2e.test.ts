// @vitest-environment node
import { Pool } from 'pg';
import type { SqlQueryable } from '../server/postgres-store';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { loadMigrations } from '../scripts/migrate';
import { PostgresWorkspaceStore } from '../server/postgres-store';
import { createApp } from '../server/app';
import type { AIRuntime, RuntimeRequest } from '../server/ai-runtime';
import { ProviderService } from '../server/provider-service';
import { ProviderStore } from '../server/provider-store';
import { SecretVault } from '../server/secret-vault';
import type { ExecutionRun } from '../server/execution-runtime/run';
import { NodeFilesystemBlobStore } from '../server/infrastructure/node-host-runtime';
import { NodeEncryptedBlobStore } from '../server/infrastructure/node-encrypted-blob-store';
import { NodePortableBundle } from '../server/infrastructure/portable-bundle';
import { semanticStateChecksum } from '../server/infrastructure/workspace-semantic-checksum';
import { portableWorkspaceFacts } from '../server/application/portable-workspace';
import { validatePortableReferences } from '../server/application/portable-references';
import { stageBundleArchive, describeBundleFile, writeBundleArchive } from '../server/infrastructure/bundle-archive';
import { decodePortableDocument, ingestPortableBlobs, ingestPortableWorkspace, NodeImportArchiveStore, stagePortableWorkspace, validatePortableContent } from '../server/infrastructure/portable-content';
import { BUNDLE_LIMITS } from '../server/domain/portable-bundle';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { portableWorkspaceSchema } from '../server/domain/portable-workspace-schema';
import journalSchema from '../server/contracts/domain-event-envelope.schema.json';
import { validatePortableHistory } from '../server/application/portable-history';
import { SqlBundleImportCheckpoints } from '../server/infrastructure/bundle-import-checkpoints';
import { completeBundleImport, prepareBundleImport } from '../server/application/prepare-bundle-import';
import { RepositoryWorkspaceUnitOfWork } from '../server/infrastructure/workspace-repository-unit-of-work';
import { NodeContentKeys } from '../server/infrastructure/node-content-keys';
import { NodeSealedContentStore } from '../server/infrastructure/node-sealed-content-store';
import { SealedReceiptContent, type SealedReceiptRef } from '../server/infrastructure/sealed-receipt-content';
import { SealedRunContent } from '../server/infrastructure/sealed-run-content';
import { SealedJournalContent } from '../server/infrastructure/sealed-journal-content';
import { SealedMessageContent } from '../server/infrastructure/sealed-message-content';
import { manifestReferenceProjection, SealedManifestContent } from '../server/infrastructure/sealed-manifest-content';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const model = { id: 'model-one', providerEndpointRef: 'endpoint-one', model: 'same-model', provider: 'Provider', displayName: 'Test', active: true };
interface TestDatabase extends SqlQueryable {
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
  transaction?<T>(callback: (transaction: SqlQueryable) => Promise<T>): Promise<T>;
  connect?(): Promise<SqlQueryable & { release(): void }>;
}
async function postgresDatabase(): Promise<TestDatabase> {
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  const schema = `m06_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}`, max: 10 });
  return Object.assign(pool, { exec: (sql: string) => pool.query(sql), close: async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } });
}
async function fixture(generate: AIRuntime['generate'], backend: 'embedded' | 'postgres') {
  const database: TestDatabase = backend === 'embedded' ? new PGlite() : await postgresDatabase();
  cleanups.push(() => database.close());
  for (const migration of await loadMigrations()) await database.exec(migration.sql);
  const store = new PostgresWorkspaceStore(database);
  const directory = await mkdtemp(join(tmpdir(), 'rhiza-m06-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const provider = new ProviderService(new ProviderStore(join(directory, 'providers.json')), new SecretVault(join(directory, 'key')), { baseUrl: 'https://example.test/v1', apiKey: 'secret-never-in-run', model: 'same-model', providerName: 'Test', chatPath: '/chat/completions', timeoutMs: 1000, temperature: 0.4, extraHeaders: {}, allowNoKey: false });
  const runtime: AIRuntime = { kind: 'provider-adapter', listModels: async () => [model], generate };
  const app = createApp(store, provider, false, runtime, undefined, join(directory, 'uploads'));
  const initial = await request(app).get('/api/workspace');
  expect(initial.status, JSON.stringify(initial.body)).toBe(200);
  await store.backfillJournal();
  return { database, store, app, runtime, provider, uploadDirectory: join(directory, 'uploads') };
}
async function* success(input: RuntimeRequest) {
  yield { type: 'RUN_END' as const, requestId: input.requestId, text: 'answer', model: 'same-model', provider: 'Provider' };
}

for (const backend of ['embedded', 'postgres'] as const) {
describe.skipIf(backend === 'postgres' && !process.env.DATABASE_URL)(`M06 durable Chat execution (${backend})`, () => {
  const setup = (generate: AIRuntime['generate']) => fixture(generate, backend);
  it('M09 encrypts rejection details and replays the same rejection without mutation', async () => {
    const { database, uploadDirectory } = await setup(success);
    const content = SealedReceiptContent.atDirectory(join(uploadDirectory, 'rejections'));
    const store = new PostgresWorkspaceStore(database, undefined, content);
    const workspaceId = store.defaultWorkspaceId;
    const commandId = randomUUID();
    const context = { commandId, commandType: 'test', actor: { actorType: 'human' as const, actorId: '00000000-0000-4000-8000-000000000002' }, scope: { scopeType: 'workspace' as const, scopeId: workspaceId }, occurredAt: new Date().toISOString() };
    const failure = { message: 'sensitive rejection details', code: 'TEST_REJECTION', status: 409 };
    const apply = vi.fn(async () => { throw Object.assign(new Error(failure.message), failure); });
    const command = { context, apply, events: () => [] };
    await expect(store.executeCommand(command)).rejects.toMatchObject(failure);
    const row = (await database.query<{ error: unknown; error_content_ref: SealedReceiptRef }>('SELECT error,error_content_ref FROM command_receipts WHERE workspace_id=$1 AND command_id=$2', [workspaceId, commandId])).rows[0];
    expect(row.error).toEqual({ sealed: true });
    expect((await store.readCommandReceipt(commandId))?.error).toEqual(failure);
    await expect(store.executeCommand(command)).rejects.toMatchObject({ ...failure, storedReceipt: true });
    await expect(store.executeWorkspaceLifecycle(context, { kind: 'create', workspaceId, name: 'unused', createdBy: context.actor.actorId })).rejects.toMatchObject({ ...failure, storedReceipt: true });
    expect(apply).toHaveBeenCalledTimes(1);
    await expect(content.read(workspaceId, commandId, row.error_content_ref)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await content.destroy(workspaceId, commandId, row.error_content_ref, 'error');
    await expect(store.executeCommand(command)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect(apply).toHaveBeenCalledTimes(1);
  });
  it('M09 resumes legacy receipt encryption and keeps plaintext when verification fails', async () => {
    const { database, uploadDirectory } = await setup(success);
    const content = SealedReceiptContent.atDirectory(join(uploadDirectory, 'receipt-migration'));
    const store = new PostgresWorkspaceStore(database, undefined, content);
    await store.sealLegacyReceiptResults();
    const workspaceId = store.defaultWorkspaceId;
    for (const commandId of ['legacy-a', 'legacy-b']) await database.query("INSERT INTO command_receipts (workspace_id,command_id,command_type,status,result) VALUES ($1,$2,'test','committed',$3::jsonb)", [workspaceId, commandId, JSON.stringify({ text: commandId })]);
    expect(await store.sealLegacyReceiptResults(1)).toBe(1);
    expect((await store.readCommandReceipt('legacy-a'))?.result).toEqual({ text: 'legacy-a' });
    const seal = vi.spyOn(content, 'seal');
    const read = vi.spyOn(content, 'read').mockResolvedValueOnce({ corrupted: true });
    await expect(store.sealLegacyReceiptResults(1)).rejects.toThrow('RECEIPT_MIGRATION_CHECKSUM_MISMATCH');
    read.mockRestore();
    const failedReference = await seal.mock.results[0].value;
    await expect(content.read(workspaceId, 'legacy-b', failedReference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect((await database.query<{ result: unknown; result_content_ref: unknown }>("SELECT result,result_content_ref FROM command_receipts WHERE command_id='legacy-b'")).rows[0]).toEqual({ result: { text: 'legacy-b' }, result_content_ref: null });
    const resumed = new PostgresWorkspaceStore(database, undefined, SealedReceiptContent.atDirectory(join(uploadDirectory, 'receipt-migration')));
    expect(await resumed.sealLegacyReceiptResults(1)).toBe(1);
    expect(await resumed.sealLegacyReceiptResults()).toBe(0);
    expect((await resumed.readCommandReceipt('legacy-b'))?.result).toEqual({ text: 'legacy-b' });
    expect((await database.query("SELECT command_id FROM command_receipts WHERE status='committed' AND result_content_ref IS NULL")).rows).toHaveLength(0);
    const failure = { message: 'legacy sensitive error', code: 'LEGACY_ERROR', status: 409 };
    await database.query("INSERT INTO command_receipts (workspace_id,command_id,command_type,status,error) VALUES ($1,'legacy-error','test','rejected',$2::jsonb)", [workspaceId, JSON.stringify(failure)]);
    const brokenRead = vi.spyOn(content, 'read').mockResolvedValueOnce({ corrupted: true });
    await expect(store.sealLegacyReceiptErrors(1)).rejects.toThrow('RECEIPT_MIGRATION_CHECKSUM_MISMATCH');
    brokenRead.mockRestore();
    await expect(content.read(workspaceId, 'legacy-error', await seal.mock.results.at(-1)!.value, 'error')).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect((await store.readCommandReceipt('legacy-error'))?.error).toEqual(failure);
    expect(await resumed.sealLegacyReceiptErrors(1)).toBe(1);
    expect(await resumed.sealLegacyReceiptErrors()).toBe(0);
    expect((await resumed.readCommandReceipt('legacy-error'))?.error).toEqual(failure);
    expect((await database.query("SELECT error FROM command_receipts WHERE command_id='legacy-error'")).rows[0].error).toEqual({ sealed: true });
    const beforeAudit = await resumed.auditReceiptKeys();
    expect(beforeAudit.filter(item => item.referenced).every(item => item.state === 'active')).toBe(true);
    expect(beforeAudit.filter(item => !item.referenced).every(item => item.state === 'revoked')).toBe(true);
    // An unpublished key is a candidate, not permission to erase it.
    const candidate = await content.seal(workspaceId, 'in-flight', { text: 'pending' });
    const afterAudit = await resumed.auditReceiptKeys();
    expect(afterAudit.filter(item => !item.referenced && item.state === 'active')).toHaveLength(1);
    expect(await content.read(workspaceId, 'in-flight', candidate)).toEqual({ text: 'pending' });
    expect(await (resumed.forWorkspace(randomUUID()) as PostgresWorkspaceStore).auditReceiptKeys()).toEqual(afterAudit);
    const errorRef = (await database.query<{ error_content_ref: SealedReceiptRef }>("SELECT error_content_ref FROM command_receipts WHERE command_id='legacy-error'")).rows[0].error_content_ref;
    await content.destroy(workspaceId, 'legacy-error', errorRef, 'error');
    expect((await resumed.auditReceiptKeys()).filter(item => item.referenced && item.state === 'revoked')).toHaveLength(1);
  });
  it('M09 encrypts committed results and destroys keys after confirmed SQL rollback', async () => {
    const { database, uploadDirectory, provider, runtime } = await setup(success);
    const content = new SealedReceiptContent(new NodeSealedContentStore(new NodeFilesystemBlobStore(uploadDirectory), new NodeContentKeys(join(uploadDirectory, 'receipt-keys'))));
    const seal = vi.spyOn(content, 'seal');
    const store = new PostgresWorkspaceStore(database, undefined, content);
    const app = createApp(store, provider, false, runtime, undefined, uploadDirectory);
    await request(app).post('/api/chat').send({ message: 'private encrypted receipt' }).expect(201);
    const rows = await database.query<{ command_id: string; result: unknown; result_content_ref: unknown }>("SELECT command_id,result,result_content_ref FROM command_receipts WHERE command_type='CreateConversationRun' AND status='committed'");
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      expect(row.result).toBeNull();
      expect(row.result_content_ref).not.toBeNull();
      expect((await store.readCommandReceipt(row.command_id))?.result).toBeDefined();
    }
    const workspaceId = randomUUID();
    const context = { commandId: randomUUID(), commandType: 'CreateWorkspace', actor: { actorType: 'human' as const, actorId: '00000000-0000-4000-8000-000000000002' }, scope: { scopeType: 'workspace' as const, scopeId: workspaceId }, occurredAt: new Date().toISOString() };
    const command = { kind: 'create' as const, workspaceId, name: 'encrypted workspace receipt', createdBy: context.actor.actorId };
    const created = await store.executeWorkspaceLifecycle(context, command);
    expect(await store.executeWorkspaceLifecycle(context, command)).toEqual(created);
    await database.exec("CREATE FUNCTION fail_receipt_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.command_id='fail-receipt' THEN RAISE EXCEPTION 'receipt write failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_receipt_write BEFORE INSERT ON command_receipts FOR EACH ROW EXECUTE FUNCTION fail_receipt_write();");
    const failedWorkspace = randomUUID();
    await expect(store.executeWorkspaceLifecycle({ ...context, commandId: 'fail-receipt', scope: { ...context.scope, scopeId: failedWorkspace } }, { ...command, workspaceId: failedWorkspace })).rejects.toThrow('receipt write failure');
    const reference = await seal.mock.results.at(-1)!.value;
    await expect(content.read(failedWorkspace, 'fail-receipt', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect((await database.query('SELECT workspace_id FROM workspaces WHERE workspace_id=$1', [failedWorkspace])).rows).toHaveLength(0);
    const uncertainDatabase = { query: database.query.bind(database), connect: async () => {
      const client = database.connect ? await database.connect() : { query: database.query.bind(database), release() {} };
      return { release: () => client.release(), query: async <T,>(sql: string, values?: unknown[]) => {
        const result = await client.query<T>(sql, values);
        if (sql === 'COMMIT') throw new Error('lost commit acknowledgement');
        return result;
      } };
    } };
    const uncertainWorkspace = randomUUID();
    const uncertainCommand = randomUUID();
    await expect(new PostgresWorkspaceStore(uncertainDatabase, undefined, content).executeWorkspaceLifecycle(
      { ...context, commandId: uncertainCommand, scope: { ...context.scope, scopeId: uncertainWorkspace } }, { ...command, workspaceId: uncertainWorkspace },
    )).rejects.toThrow('lost commit acknowledgement');
    expect((await store.forWorkspace(uncertainWorkspace).readCommandReceipt!(uncertainCommand))?.result).toMatchObject({ workspaceId: uncertainWorkspace });
  });
  it('M09 reads encrypted receipts and refuses missing keys or receipt identity substitution', async () => {
    const { database, uploadDirectory } = await setup(success);
    const content = new SealedReceiptContent(new NodeSealedContentStore(new NodeFilesystemBlobStore(uploadDirectory), new NodeContentKeys(join(uploadDirectory, 'keys'))));
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const commandId = randomUUID();
    const value = { text: 'private receipt result' };
    const reference = await content.seal(workspaceId, commandId, value);
    await database.query("INSERT INTO command_receipts (workspace_id,command_id,command_type,status,result_content_ref) VALUES ($1,$2,'test','committed',$3::jsonb)", [workspaceId, commandId, JSON.stringify(reference)]);
    const store = new PostgresWorkspaceStore(database, workspaceId, content);
    expect((await store.readCommandReceipt(commandId))?.result).toEqual(value);
    const context = { commandId, commandType: 'test', actor: { actorType: 'human' as const, actorId: '00000000-0000-4000-8000-000000000002' }, scope: { scopeType: 'workspace' as const, scopeId: workspaceId }, occurredAt: new Date().toISOString() };
    const apply = vi.fn(async () => { throw new Error('duplicate command must not mutate'); });
    expect((await store.executeCommand({ context, apply, events: () => [] })).value).toEqual(value);
    expect(apply).not.toHaveBeenCalled();
    expect(await store.executeWorkspaceLifecycle(context, { kind: 'create', workspaceId, name: 'unused', createdBy: context.actor.actorId })).toEqual(value);
    await expect(new PostgresWorkspaceStore(database).readCommandReceipt(commandId)).rejects.toThrow('RECEIPT_CONTENT_STORE_UNAVAILABLE');
    await expect(content.read(workspaceId, 'other-command', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect(await store.forWorkspace(randomUUID()).readCommandReceipt!(commandId)).toBeUndefined();
    await content.destroy(workspaceId, commandId, reference);
    await expect(store.readCommandReceipt(commandId)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
  });
  it('M09 migrates legacy terminal Run inputs atomically and restores immutable guards', async () => {
    const { app, store, database, uploadDirectory } = await setup(success);
    await request(app).post('/api/chat').send({ message: 'legacy input' }).expect(201);
    const [run] = await store.listRuns();
    const content = SealedRunContent.atDirectory(join(uploadDirectory, 'run-migration'));
    const migration = new PostgresWorkspaceStore(database, undefined, undefined, content);
    const seal = vi.spyOn(content, 'seal');
    await database.exec(`CREATE FUNCTION reject_run_migration() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'migration interrupted'; END $$;
      CREATE TRIGGER reject_run_migration BEFORE UPDATE ON execution_runs FOR EACH ROW EXECUTE FUNCTION reject_run_migration();`);
    await expect(migration.sealLegacyRunInputs()).rejects.toThrow('migration interrupted');
    expect(await store.getRun(run.id)).toEqual(run);
    await expect(content.read(run.workspaceId, run.id, await seal.mock.results[0].value, run.inputHash)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await database.exec('DROP TRIGGER reject_run_migration ON execution_runs; DROP FUNCTION reject_run_migration();');
    await expect(database.query("UPDATE execution_runs SET input_envelope='{}'::jsonb WHERE run_id=$1", [run.id])).rejects.toThrow('immutable');
    expect(await migration.sealLegacyRunInputs(1)).toBe(1);
    expect(await migration.sealLegacyRunInputs()).toBe(0);
    expect(await migration.getRun(run.id)).toEqual(run);
    await expect(database.query("UPDATE execution_runs SET input_content_ref=NULL WHERE run_id=$1", [run.id])).rejects.toThrow('immutable');
    await expect(database.query("DELETE FROM execution_runs WHERE run_id=$1", [run.id])).rejects.toThrow('immutable');
  });
  it('M09 decrypts stored Run inputs for reads and export and fails closed without keys', async () => {
    const { app, store, database, uploadDirectory, provider, runtime } = await setup(success);
    await request(app).post('/api/chat').send({ message: 'private Run input' }).expect(201);
    const [source] = await store.listRuns();
    const run = { ...source, id: randomUUID(), commandId: randomUUID() };
    const content = SealedRunContent.atDirectory(join(uploadDirectory, 'run-inputs'));
    const reference = await content.seal(run.workspaceId, run.id, run.input, run.inputHash);
    await database.query(`INSERT INTO execution_runs(run_id,workspace_id,command_id,node_id,status,attempt,input_envelope,input_hash,model_spec_ref,provider_endpoint_ref,record,input_content_ref)
      VALUES ($1,$2,$3,$4,$5,1,'{"sealed":true}'::jsonb,$6,$7,$8,$9::jsonb,$10::jsonb)`,
    [run.id,run.workspaceId,run.commandId,run.nodeId,run.status,run.inputHash,run.input.executor.modelSpecRef,run.input.executor.providerEndpointRef,JSON.stringify({ ...run, input: { sealed: true } }),JSON.stringify(reference)]);
    const reader = new PostgresWorkspaceStore(database, undefined, undefined, content);
    const encryptedApp = createApp(reader, provider, false, runtime, undefined, uploadDirectory);
    await request(encryptedApp).post('/api/chat').send({ message: 'encrypted new input' }).expect(201);
    const stored = (await database.query<{ input_envelope: unknown; record: { input: unknown }; input_content_ref: unknown }>('SELECT input_envelope,record,input_content_ref FROM execution_runs WHERE run_id<>$1 AND run_id<>$2', [source.id, run.id])).rows[0];
    expect(stored.input_envelope).toEqual({ sealed: true });
    expect(stored.record.input).toEqual({ sealed: true });
    expect(stored.input_content_ref).toBeTruthy();
    const seal = vi.spyOn(content, 'seal');
    await database.exec(`CREATE FUNCTION reject_test_run() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test run insert failure'; END $$;
      CREATE TRIGGER reject_test_run BEFORE INSERT ON execution_runs FOR EACH ROW EXECUTE FUNCTION reject_test_run();`);
    await request(encryptedApp).post('/api/chat').send({ message: 'rollback input' }).expect(500);
    const failedRef = await seal.mock.results[0].value;
    const [failedWorkspace, failedRun, , failedHash] = seal.mock.calls[0];
    await expect(content.read(failedWorkspace, failedRun, failedRef, failedHash)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await database.exec('DROP TRIGGER reject_test_run ON execution_runs; DROP FUNCTION reject_test_run();');
    expect(await reader.getRun(run.id)).toEqual(run);
    expect((await reader.listRuns()).find(item => item.id === run.id)).toEqual(run);
    expect((await reader.readPortableWorkspace()).runs.find(item => item.id === run.id)).toEqual(run);
    await reader.readGraphProjection();
    await expect(store.getRun(run.id)).rejects.toThrow('RUN_CONTENT_STORE_UNAVAILABLE');
    expect(await reader.forWorkspace(randomUUID()).getRun!(run.id)).toBeUndefined();
    await content.destroy(run.workspaceId, run.id, reference);
    await expect(reader.getRun(run.id)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await expect(reader.readPortableWorkspace()).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
  });
  it('M09 migrates legacy Journal payloads with rollback and unchanged event envelopes', async () => {
    const { app, store, database, uploadDirectory } = await setup(success);
    await request(app).post('/api/chat').send({ message: 'legacy journal input' }).expect(201);
    const original = await store.readJournal();
    const content = SealedJournalContent.atDirectory(join(uploadDirectory, 'journal-migration'));
    const migration = new PostgresWorkspaceStore(database, undefined, undefined, undefined, content);
    const seal = vi.spyOn(content, 'seal');
    await database.exec(`CREATE FUNCTION reject_journal_migration() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'journal migration interrupted'; END $$;
      CREATE TRIGGER reject_journal_migration BEFORE UPDATE ON workspace_events FOR EACH ROW EXECUTE FUNCTION reject_journal_migration();`);
    await expect(migration.sealLegacyJournalPayloads()).rejects.toThrow('journal migration interrupted');
    expect(await store.readJournal()).toEqual(original);
    for (const [index, [workspaceId, eventId]] of seal.mock.calls.entries()) {
      await expect(content.read(workspaceId, eventId, await seal.mock.results[index].value)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    }
    await database.exec('DROP TRIGGER reject_journal_migration ON workspace_events; DROP FUNCTION reject_journal_migration();');
    await expect(database.query('DELETE FROM workspace_events WHERE event_id=$1', [original[0].eventId])).rejects.toThrow('append-only');
    expect(await migration.sealLegacyJournalPayloads(1)).toBe(1);
    expect(await migration.sealLegacyJournalPayloads()).toBe(original.length - 1);
    expect(await migration.sealLegacyJournalPayloads()).toBe(0);
    expect(await migration.readJournal()).toEqual(original);
    expect(await migration.backfillJournal()).toMatchObject({ created: false, eventCount: original.length });
    await expect(database.query('UPDATE workspace_events SET payload_content_ref=NULL WHERE event_id=$1', [original[0].eventId])).rejects.toThrow('append-only');
  });
  it('M09 encrypts command and lifecycle Journal writes and revokes keys on rollback', async () => {
    const { database, uploadDirectory, provider, runtime } = await setup(success);
    const content = SealedJournalContent.atDirectory(join(uploadDirectory, 'journal-writes'));
    const store = new PostgresWorkspaceStore(database, undefined, undefined, undefined, content);
    const app = createApp(store, provider, false, runtime, undefined, uploadDirectory);
    await request(app).post('/api/chat').send({ message: 'private journal input' }).expect(201);
    const created = await request(app).post('/api/v1/workspaces').send({ name: 'encrypted lifecycle' }).expect(201);
    const rows = (await database.query<{ payload: unknown; payload_content_ref: unknown }>('SELECT payload,payload_content_ref FROM workspace_events WHERE payload_content_ref IS NOT NULL')).rows;
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every(row => JSON.stringify(row.payload) === JSON.stringify({ sealed: true }))).toBe(true);
    expect((await store.readJournal()).some(event => event.payload.stateChanges)).toBe(true);
    const scoped = store.forWorkspace(created.body.workspace.workspaceId) as PostgresWorkspaceStore;
    expect(await scoped.backfillJournal()).toMatchObject({ created: false });
    const seal = vi.spyOn(content, 'seal');
    await database.exec(`CREATE FUNCTION reject_journal_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'journal write interrupted'; END $$;
      CREATE TRIGGER reject_journal_write BEFORE INSERT ON workspace_events FOR EACH ROW EXECUTE FUNCTION reject_journal_write();`);
    await request(app).post('/api/chat').send({ message: 'rollback journal' }).expect(500);
    expect(seal.mock.calls.length).toBeGreaterThan(0);
    for (const [index, [workspaceId, eventId]] of seal.mock.calls.entries()) {
      await expect(content.read(workspaceId, eventId, await seal.mock.results[index].value)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    }
  });
  it('M09 reads an encrypted Journal baseline without duplicating it and fails closed after revocation', async () => {
    const { database, store, uploadDirectory } = await setup(success);
    const [event] = await store.readJournal();
    const content = SealedJournalContent.atDirectory(join(uploadDirectory, 'journal-content'));
    const reference = await content.seal(event.workspaceId, event.eventId, event.payload);
    // Isolated fixture models a migrated row; production migration is separate.
    await database.exec('ALTER TABLE workspace_events DISABLE TRIGGER workspace_events_append_only');
    try {
      await database.query(`UPDATE workspace_events SET payload='{"sealed":true}'::jsonb,payload_content_ref=$2::jsonb WHERE event_id=$1`, [event.eventId, JSON.stringify(reference)]);
    } finally { await database.exec('ALTER TABLE workspace_events ENABLE TRIGGER workspace_events_append_only'); }
    const reader = new PostgresWorkspaceStore(database, undefined, undefined, undefined, content);
    expect(await reader.readJournal()).toEqual([event]);
    expect((await reader.readPortableWorkspace()).journal).toEqual([event]);
    expect(await reader.backfillJournal()).toMatchObject({ created: false, eventCount: 1 });
    await expect(store.readJournal()).rejects.toThrow('JOURNAL_CONTENT_STORE_UNAVAILABLE');
    await content.destroy(event.workspaceId, event.eventId, reference);
    await expect(reader.readJournal()).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await expect(reader.backfillJournal()).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect((await database.query('SELECT event_id FROM workspace_events')).rows).toHaveLength(1);
  });
  it('M09 migrates legacy message content without changing identities and rolls back failures', async () => {
    const { app, database, store, uploadDirectory } = await setup(success);
    await request(app).post('/api/chat').send({ message: 'legacy message' }).expect(201);
    const original = (await store.read()).messages;
    const content = SealedMessageContent.atDirectory(join(uploadDirectory, 'message-migration'));
    const migration = new PostgresWorkspaceStore(database, undefined, undefined, undefined, undefined, content);
    const seal = vi.spyOn(content, 'seal');
    const read = vi.spyOn(content, 'read').mockResolvedValueOnce({ text: 'corrupt' });
    await expect(migration.sealLegacyMessageContent()).rejects.toThrow('MESSAGE_MIGRATION_CHECKSUM_MISMATCH');
    read.mockRestore();
    expect((await store.read()).messages).toEqual(original);
    const [workspaceId, messageId] = seal.mock.calls[0];
    await expect(content.read(workspaceId, messageId, await seal.mock.results[0].value)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect(await migration.sealLegacyMessageContent(1)).toBe(1);
    expect(await migration.sealLegacyMessageContent()).toBe(original.length - 1);
    expect(await migration.sealLegacyMessageContent()).toBe(0);
    expect((await migration.read()).messages).toEqual(original);
  });
  it('M09 restores encrypted message content for workspace export and conversation preparation', async () => {
    const { app, database, store, uploadDirectory, provider, runtime } = await setup(success);
    const response = await request(app).post('/api/chat').send({ message: 'encrypted history message' }).expect(201);
    const workspace = await store.read();
    const message = workspace.messages.find(item => item.id === response.body.assistantMessage.id)!;
    const content = SealedMessageContent.atDirectory(join(uploadDirectory, 'message-reads'));
    const reference = await content.seal(workspace.projectId, message.id, message);
    await database.query("UPDATE rhiza_messages SET body='',reasoning=NULL,tool_calls=NULL,content_ref=$2::jsonb WHERE id=$1", [message.id, JSON.stringify(reference)]);
    const reader = new PostgresWorkspaceStore(database, undefined, undefined, undefined, undefined, content);
    const encryptedApp = createApp(reader, provider, false, runtime, undefined, uploadDirectory);
    await request(encryptedApp).post('/api/chat').send({ message: 'new encrypted message' }).expect(201);
    const stored = (await database.query<{ body: string; reasoning: unknown; tool_calls: unknown }>('SELECT body,reasoning,tool_calls FROM rhiza_messages WHERE content_ref IS NOT NULL')).rows;
    expect(stored.length).toBeGreaterThan(1);
    expect(stored.every(row => row.body === '' && row.reasoning === null && row.tool_calls === null)).toBe(true);
    const seal = vi.spyOn(content, 'seal');
    await database.exec(`CREATE FUNCTION reject_message_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'message write interrupted'; END $$;
      CREATE TRIGGER reject_message_write BEFORE INSERT ON rhiza_messages FOR EACH ROW EXECUTE FUNCTION reject_message_write();`);
    await request(encryptedApp).post('/api/chat').send({ message: 'rollback message' }).expect(500);
    expect(seal.mock.calls.length).toBeGreaterThan(0);
    for (const [index, [workspaceId, messageId]] of seal.mock.calls.entries()) {
      await expect(content.read(workspaceId, messageId, await seal.mock.results[index].value)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    }
    await database.exec('DROP TRIGGER reject_message_write ON rhiza_messages; DROP FUNCTION reject_message_write();');
    expect((await reader.read()).messages.find(item => item.id === message.id)).toEqual(message);
    expect((await reader.readPortableWorkspace()).workspace.messages.find(item => item.id === message.id)).toEqual(message);
    expect((await reader.readConversationPreparation([])).messages.find(item => item.id === message.id)).toEqual(message);
    await expect(store.read()).rejects.toThrow('MESSAGE_CONTENT_STORE_UNAVAILABLE');
    await content.destroy(workspace.projectId, message.id, reference);
    await expect(reader.read()).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await expect(reader.readConversationPreparation([])).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
  });
  it('M09 migrates old Manifests atomically and restores immutable protection after failure', async () => {
    const { app, database, store, uploadDirectory } = await setup(success);
    await request(app).post('/api/chat').send({ message: 'legacy Manifest' }).expect(201);
    const original = (await store.read()).manifests;
    const content = SealedManifestContent.atDirectory(join(uploadDirectory, 'manifest-migration'));
    const migration = new PostgresWorkspaceStore(database, undefined, undefined, undefined, undefined, undefined, content);
    const seal = vi.spyOn(content, 'seal');
    await database.exec(`CREATE FUNCTION reject_manifest_migration() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'manifest migration interrupted'; END $$;
      CREATE TRIGGER reject_manifest_migration BEFORE UPDATE ON rhiza_context_manifests FOR EACH ROW EXECUTE FUNCTION reject_manifest_migration();`);
    await expect(migration.sealLegacyManifestContent()).rejects.toThrow('manifest migration interrupted');
    expect((await store.read()).manifests).toEqual(original);
    for (const [index, [failed]] of seal.mock.calls.entries()) {
      await expect(content.read(failed.projectId, failed.id, await seal.mock.results[index].value, manifestReferenceProjection(failed))).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    }
    await database.exec('DROP TRIGGER reject_manifest_migration ON rhiza_context_manifests; DROP FUNCTION reject_manifest_migration();');
    await expect(database.query('UPDATE rhiza_context_manifests SET content_ref=NULL')).rejects.toThrow('immutable');
    expect(await migration.sealLegacyManifestContent()).toBe(original.length);
    expect(await migration.sealLegacyManifestContent()).toBe(0);
    expect((await migration.read()).manifests).toEqual(original);
    await expect(database.query('UPDATE rhiza_context_manifests SET content_ref=NULL')).rejects.toThrow('immutable');
  });
  it('M09 restores encrypted Manifests for workspace and frozen context reads', async () => {
    const { app, database, store, uploadDirectory, provider, runtime } = await setup(success);
    const response = await request(app).post('/api/chat').send({ message: 'private manifest history' }).expect(201);
    const manifest = (await store.read()).manifests.find(item => item.id === response.body.manifest.id)!;
    const content = SealedManifestContent.atDirectory(join(uploadDirectory, 'manifest-reads'));
    const reference = await content.seal(manifest);
    await database.exec('ALTER TABLE rhiza_context_manifests DISABLE TRIGGER rhiza_context_manifests_immutable');
    try {
      await database.query('UPDATE rhiza_context_manifests SET manifest=$2::jsonb,content_ref=$3::jsonb WHERE id=$1', [manifest.id, JSON.stringify(manifestReferenceProjection(manifest)), JSON.stringify(reference)]);
    } finally { await database.exec('ALTER TABLE rhiza_context_manifests ENABLE TRIGGER rhiza_context_manifests_immutable'); }
    const reader = new PostgresWorkspaceStore(database, undefined, undefined, undefined, undefined, undefined, content);
    const encryptedApp = createApp(reader, provider, false, runtime, undefined, uploadDirectory);
    const next = await request(encryptedApp).post('/api/chat').send({ message: 'new sealed Manifest' }).expect(201);
    const stored = (await database.query<{ manifest: unknown; content_ref: unknown }>('SELECT manifest,content_ref FROM rhiza_context_manifests WHERE id=$1', [next.body.manifest.id])).rows[0];
    expect(stored.content_ref).toBeTruthy();
    expect(stored.manifest).toEqual(JSON.parse(JSON.stringify(manifestReferenceProjection(next.body.manifest))));
    const seal = vi.spyOn(content, 'seal');
    await database.exec(`CREATE FUNCTION reject_manifest_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'manifest write interrupted'; END $$;
      CREATE TRIGGER reject_manifest_write BEFORE INSERT ON rhiza_context_manifests FOR EACH ROW EXECUTE FUNCTION reject_manifest_write();`);
    await request(encryptedApp).post('/api/chat').send({ message: 'rollback Manifest' }).expect(500);
    expect(seal.mock.calls.length).toBeGreaterThan(0);
    for (const [index, [failed]] of seal.mock.calls.entries()) {
      await expect(content.read(failed.projectId, failed.id, await seal.mock.results[index].value, manifestReferenceProjection(failed))).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    }
    await database.exec('DROP TRIGGER reject_manifest_write ON rhiza_context_manifests; DROP FUNCTION reject_manifest_write();');
    expect((await reader.read()).manifests.find(item => item.id === manifest.id)).toEqual(manifest);
    expect((await reader.readContextHistory({ manifestId: manifest.id }))?.manifest).toEqual(manifest);
    expect((await reader.readPortableWorkspace()).workspace.manifests.find(item => item.id === manifest.id)).toEqual(manifest);
    await expect(store.read()).rejects.toThrow('MANIFEST_CONTENT_STORE_UNAVAILABLE');
    await content.destroy(manifest.projectId, manifest.id, reference);
    await expect(reader.readContextHistory({ manifestId: manifest.id })).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await expect(reader.read()).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
  });
  it('M09 constrains sealed Manifest projections while retaining frozen-context validation', async () => {
    const { app, database, store } = await setup(success);
    const response = await request(app).post('/api/chat').send({ message: 'manifest encryption' }).expect(201);
    const manifest = (await store.read()).manifests.find(item => item.id === response.body.manifest.id)!;
    const projection = manifestReferenceProjection(manifest);
    const reference = { format: 'rhiza.sealed-manifest.v1', contentId: 'manifest-content', reference: { version: 1, digest: 'a'.repeat(64), size: 2,
      ciphertext: { digestAlgorithm: 'sha256', digest: 'b'.repeat(64), blobRef: `sha256/bb/${'b'.repeat(64)}`, size: 31 } } };
    const insert = (value: unknown, ref: unknown = reference) => database.query(`INSERT INTO rhiza_context_manifests(id,project_id,node_id,request_id,mode,provider,model,runtime,estimated_tokens,manifest,created_at,content_ref)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb)`, [randomUUID(),manifest.projectId,manifest.nodeId,randomUUID(),manifest.mode,manifest.provider,manifest.model,manifest.runtime,manifest.estimatedTokens,JSON.stringify(value),manifest.createdAt,JSON.stringify(ref)]);
    await insert(projection);
    await expect(insert({ ...projection, privateText: 'private' })).rejects.toThrow('manifest_sealed_content_valid');
    await expect(insert(projection, { format: reference.format })).rejects.toThrow('manifest_sealed_content_valid');
    await expect(insert({ ...projection, contextItems: [{ resourceId: 'missing', resourceVersionId: 'missing', digest: 'a'.repeat(64), contributorVersion: '1', selectionMode: 'CURRENT', priority: 1, reason: '[sealed]' }] })).rejects.toThrow('existing scoped ResourceVersion');
    await expect(database.exec(await readFile('db/migrations/0020_sealed_manifest_content.down.sql', 'utf8'))).rejects.toThrow('Cannot remove sealed Manifest references');
    await expect(database.query('UPDATE rhiza_context_manifests SET content_ref=NULL WHERE content_ref IS NOT NULL')).rejects.toThrow('immutable');
  });
  it('M09 forbids plaintext message replicas beside sealed content references', async () => {
    const { database, store } = await setup(success);
    const workspace = await store.read();
    const reference = { format: 'rhiza.sealed-message.v1', contentId: 'message-content', reference: { version: 1, digest: 'a'.repeat(64), size: 2,
      ciphertext: { digestAlgorithm: 'sha256', digest: 'b'.repeat(64), blobRef: `sha256/bb/${'b'.repeat(64)}`, size: 31 } } };
    const insert = (ref: unknown, body = '', reasoning: string | null = null, toolCalls: unknown = null) => database.query(
      "INSERT INTO rhiza_messages(id,node_id,kind,body,reasoning,tool_calls,content_ref) VALUES ($1,$2,'assistant',$3,$4,$5::jsonb,$6::jsonb)",
      [randomUUID(), workspace.activeNodeId, body, reasoning, toolCalls === null ? null : JSON.stringify(toolCalls), JSON.stringify(ref)]);
    await insert(reference);
    await expect(insert(reference, 'private text')).rejects.toThrow('message_sealed_content_valid');
    await expect(insert(reference, '', 'private reasoning')).rejects.toThrow('message_sealed_content_valid');
    await expect(insert(reference, '', null, [{ arguments: 'private' }])).rejects.toThrow('message_sealed_content_valid');
    await expect(insert({ format: reference.format })).rejects.toThrow('message_sealed_content_valid');
    await expect(insert({ ...reference, extra: 'private' })).rejects.toThrow('message_sealed_content_valid');
    await expect(database.exec(await readFile('db/migrations/0019_sealed_message_content.down.sql', 'utf8'))).rejects.toThrow('Cannot remove sealed message references');
  });
  it('M09 constrains sealed Journal payloads and preserves append-only protection', async () => {
    const { database, store } = await setup(success);
    const reference = { format: 'rhiza.sealed-journal.v1', contentId: 'event-content', reference: { version: 1, digest: 'a'.repeat(64), size: 2,
      ciphertext: { digestAlgorithm: 'sha256', digest: 'b'.repeat(64), blobRef: `sha256/bb/${'b'.repeat(64)}`, size: 31 } } };
    let sequence = 100;
    const insert = async (ref: unknown, payload: unknown = { sealed: true }) => {
      const id = randomUUID();
      await database.query(`INSERT INTO workspace_events(event_id,workspace_id,sequence,ce_specversion,rhiza_envelope_version,event_type,event_source,subject,data_schema,aggregate_type,aggregate_id,aggregate_revision,actor_ref,scope_ref,command_id,event_index,payload,occurred_at,payload_content_ref)
        SELECT $1::uuid,workspace_id,$2,ce_specversion,rhiza_envelope_version,event_type,event_source,subject,data_schema,aggregate_type,aggregate_id,aggregate_revision,actor_ref,scope_ref,$1::text,0,$3::jsonb,occurred_at,$4::jsonb
        FROM workspace_events WHERE workspace_id=$5 AND sequence=1`, [id, sequence++, JSON.stringify(payload), JSON.stringify(ref), store.defaultWorkspaceId]);
      return id;
    };
    const id = await insert(reference);
    await expect(insert(reference, { text: 'private payload' })).rejects.toThrow('journal_sealed_payload_valid');
    await expect(insert({ format: reference.format })).rejects.toThrow('journal_sealed_payload_valid');
    await expect(insert({ ...reference, extra: 'private' })).rejects.toThrow('journal_sealed_payload_valid');
    await expect(database.query('UPDATE workspace_events SET payload_content_ref=NULL WHERE event_id=$1', [id])).rejects.toThrow('append-only');
    await expect(database.query('DELETE FROM workspace_events WHERE event_id=$1', [id])).rejects.toThrow('append-only');
    await expect(database.exec(await readFile('db/migrations/0018_sealed_journal_payloads.down.sql', 'utf8'))).rejects.toThrow('Cannot remove sealed Journal references');
  });
  it('M09 constrains sealed Run input replicas and keeps references immutable', async () => {
    const { database, store } = await setup(success);
    const reference = { format: 'rhiza.sealed-run-input.v1', contentId: 'run-content', reference: { version: 1, digest: 'a'.repeat(64), size: 2,
      ciphertext: { digestAlgorithm: 'sha256', digest: 'b'.repeat(64), blobRef: `sha256/bb/${'b'.repeat(64)}`, size: 31 } } };
    const insert = async (ref: unknown, input: unknown = { sealed: true }) => {
      const id = randomUUID();
      const record = { id, workspaceId: store.defaultWorkspaceId, input, inputHash: 'a'.repeat(64), status: 'created' };
      await database.query(`INSERT INTO execution_runs(run_id,workspace_id,command_id,node_id,status,attempt,input_envelope,input_hash,model_spec_ref,provider_endpoint_ref,record,input_content_ref)
        VALUES ($1,$2,$1,'node','created',1,$3::jsonb,$4,'model','endpoint',$5::jsonb,$6::jsonb)`,
      [id, store.defaultWorkspaceId, JSON.stringify(input), record.inputHash, JSON.stringify(record), JSON.stringify(ref)]);
      return id;
    };
    const id = await insert(reference);
    await expect(insert(reference, { text: 'private' })).rejects.toThrow('execution_run_sealed_input_valid');
    await expect(insert({ format: reference.format })).rejects.toThrow('execution_run_sealed_input_valid');
    await expect(insert({ ...reference, plaintext: 'private' })).rejects.toThrow('execution_run_sealed_input_valid');
    await expect(database.query('UPDATE execution_runs SET input_content_ref=$2::jsonb WHERE run_id=$1', [id, JSON.stringify({ ...reference, contentId: 'replacement' })])).rejects.toThrow('content reference is immutable');
    await database.query(`UPDATE execution_runs SET status='dispatching',record=record || '{"status":"dispatching"}'::jsonb WHERE run_id=$1`, [id]);
    await expect(database.exec(await readFile('db/migrations/0017_sealed_run_inputs.down.sql', 'utf8'))).rejects.toThrow('Cannot remove sealed Run references');
  });
  it('M09 stores sealed receipt references without duplicate plaintext and guards rollback', async () => {
    const { database } = await setup(success);
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const reference = { format: 'rhiza.sealed-receipt.v1', contentId: 'receipt-content', reference: { version: 1, digest: 'a'.repeat(64), size: 2,
      ciphertext: { digestAlgorithm: 'sha256', digest: 'b'.repeat(64), blobRef: `sha256/bb/${'b'.repeat(64)}`, size: 31 } } };
    const insert = (value: unknown, result: unknown = null) => database.query("INSERT INTO command_receipts (workspace_id,command_id,command_type,status,result,result_content_ref) VALUES ($1,$2,'test','committed',$3::jsonb,$4::jsonb)", [workspaceId, randomUUID(), result === null ? null : JSON.stringify(result), JSON.stringify(value)]);
    await insert(reference);
    await expect(insert(reference, { text: 'plaintext' })).rejects.toThrow('command_receipt_sealed_result_valid');
    await expect(insert({ ...reference, plaintext: 'leak' })).rejects.toThrow('command_receipt_sealed_result_valid');
    await expect(insert({ format: reference.format })).rejects.toThrow('command_receipt_sealed_result_valid');
    await expect(insert({ ...reference, reference: { ...reference.reference, size: -1 } })).rejects.toThrow('command_receipt_sealed_result_valid');
    await expect(database.exec(await readFile('db/migrations/0015_sealed_receipt_results.down.sql', 'utf8'))).rejects.toThrow('Cannot remove sealed receipt references');
    const insertError = (value: unknown, error: unknown = { sealed: true }) => database.query("INSERT INTO command_receipts (workspace_id,command_id,command_type,status,error,error_content_ref) VALUES ($1,$2,'test','rejected',$3::jsonb,$4::jsonb)", [workspaceId, randomUUID(), JSON.stringify(error), JSON.stringify(value)]);
    await insertError(reference);
    await expect(insertError(reference, { message: 'sensitive error', sealed: true })).rejects.toThrow('command_receipt_sealed_error_valid');
    await expect(insertError({ format: reference.format })).rejects.toThrow('command_receipt_sealed_error_valid');
    await expect(insertError({ ...reference, extra: 'plaintext' })).rejects.toThrow('command_receipt_sealed_error_valid');
    await expect(database.exec(await readFile('db/migrations/0016_sealed_receipt_errors.down.sql', 'utf8'))).rejects.toThrow('Cannot remove sealed error references');
  });
  it('M09 authorizes Purge from current membership role rather than creator identity', async () => {
    const { database, store, app } = await setup(success);
    const userId = '00000000-0000-4000-8000-000000000002';
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    expect(await store.workspaceDirectory.isOwner!(userId, workspaceId)).toBe(true);
    await database.query("UPDATE workspace_members SET role='member' WHERE workspace_id=$1 AND user_id=$2", [workspaceId, userId]);
    expect(await store.workspaceDirectory.isOwner!(userId, workspaceId)).toBe(false);
    expect(await store.workspaceDirectory.listWorkspaces(userId)).toHaveLength(1);
    expect(await store.workspaceDirectory.isOwner!(userId, randomUUID())).toBe(false);
    const denied = await request(app).post('/api/graph/nodes/unknown/purge').send({ confirmation: 'PURGE unknown', reason: 'test' }).expect(403);
    expect(denied.body.error.code).toBe('WORKSPACE_OWNER_REQUIRED');
  });
  it('M09 persists owner-scoped import checkpoints without creating destination data', async () => {
    const { database } = await setup(success);
    const checkpoints = new SqlBundleImportCheckpoints(database);
    const identity = { importId: randomUUID(), ownerId: 'import-owner', workspaceId: randomUUID(), archiveDigest: 'a'.repeat(64), stateDigest: 'b'.repeat(64) };
    const first = await checkpoints.begin(identity);
    expect(first).toEqual({ ...identity, phase: 'validated', revision: 1 });
    expect(await checkpoints.begin(identity)).toEqual(first);
    await expect(database.query("UPDATE bundle_imports SET phase='activated',revision=revision+1 WHERE import_id=$1", [identity.importId])).rejects.toThrow('BUNDLE_IMPORT_INVALID_TRANSITION');
    await expect(database.query("UPDATE bundle_imports SET owner_id='intruder' WHERE import_id=$1", [identity.importId])).rejects.toThrow('BUNDLE_IMPORT_INVALID_TRANSITION');
    await expect(checkpoints.begin({ ...identity, archiveDigest: 'c'.repeat(64) })).rejects.toThrow('BUNDLE_IMPORT_CONFLICT');
    await expect(checkpoints.begin({ ...identity, ownerId: 'other-owner' })).rejects.toThrow('BUNDLE_IMPORT_CONFLICT');
    expect(await checkpoints.read(identity.importId, 'other-owner')).toBeUndefined();
    await expect(checkpoints.markBlobsReady(identity.importId, 'other-owner', 1)).rejects.toThrow('BUNDLE_IMPORT_CONFLICT');
    const results = await Promise.allSettled([checkpoints.markBlobsReady(identity.importId, identity.ownerId, 1), checkpoints.markBlobsReady(identity.importId, identity.ownerId, 1)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(await new SqlBundleImportCheckpoints(database).read(identity.importId, identity.ownerId)).toEqual({ ...identity, phase: 'blobs-ready', revision: 2 });
    await expect(database.query("UPDATE bundle_imports SET phase='validated',revision=revision+1 WHERE import_id=$1", [identity.importId])).rejects.toThrow('BUNDLE_IMPORT_INVALID_TRANSITION');
    expect((await database.query('SELECT id FROM rhiza_projects WHERE id=$1', [identity.workspaceId])).rows).toHaveLength(0);
    expect((await database.query('SELECT workspace_id FROM workspaces WHERE workspace_id=$1', [identity.workspaceId])).rows).toHaveLength(0);
    const concurrentIdentity = { ...identity, importId: randomUUID() };
    let release!: () => void;
    const bothIngesting = new Promise<void>(resolve => { release = resolve; });
    let arrivals = 0;
    const ingest = async () => { if (++arrivals === 2) release(); await bothIngesting; };
    const prepared = await Promise.all([prepareBundleImport(concurrentIdentity, checkpoints, ingest), prepareBundleImport(concurrentIdentity, checkpoints, ingest)]);
    expect(prepared[0]).toEqual(prepared[1]);
    expect(prepared[0]).toMatchObject({ phase: 'blobs-ready', revision: 2 });
  });
  it('M09 captures complete portable facts with closed historical references', async () => {
    const { app, store, uploadDirectory, database, provider, runtime } = await setup(success);
    await request(app).post('/api/chat').send({ message: 'portable history' }).expect(201);
    const facts = await store.readPortableWorkspace();
    expect(facts.runs).toHaveLength(1);
    expect(facts.journal[0].sequence).toBe(1);
    expect(facts.provenance.length).toBe(facts.workspace.messages.filter(message => message.kind === 'assistant').length);
    const portable = portableWorkspaceFacts(facts, input => semanticStateChecksum(input as Record<string, unknown>));
    expect(() => validatePortableReferences(portable)).not.toThrow();
    expect(() => validatePortableHistory(portable, semanticStateChecksum)).not.toThrow();
    const encryptedBlobs = new NodeEncryptedBlobStore(new NodeSealedContentStore(
      new NodeFilesystemBlobStore(join(uploadDirectory, 'encrypted-export')),
      new NodeContentKeys(join(uploadDirectory, 'encrypted-export-keys')),
    ));
    const originalRawBlobs = new NodeFilesystemBlobStore(uploadDirectory);
    const originalBlobs = new NodeEncryptedBlobStore(new NodeSealedContentStore(
      originalRawBlobs,
      new NodeContentKeys(join(uploadDirectory, 'resource-keys')),
    ), originalRawBlobs);
    const locations = new Map<string, string>();
    expect(facts.workspace.resourceVersions.length).toBeGreaterThan(0);
    for (const version of facts.workspace.resourceVersions) {
      const stored = await encryptedBlobs.put(await originalBlobs.read(version.blobRef, version.digest), {
        workspaceId: facts.workspace.projectId, contentId: version.id,
      });
      locations.set(version.blobRef, stored.blobRef);
    }
    const encryptedFacts = JSON.parse(JSON.stringify(facts, (key, value) => key === 'blobRef' && locations.has(value) ? locations.get(value) : value));
    const encryptedExport = await new NodePortableBundle(encryptedBlobs).export(encryptedFacts);
    try {
      const encryptedPath = join(uploadDirectory, 'encrypted-source.rhiza');
      await writeFile(encryptedPath, encryptedExport.bytes);
      const stagedEncrypted = await stagePortableWorkspace(encryptedPath);
      try {
        expect(stagedEncrypted.facts).toEqual(portable);
        expect(JSON.stringify(stagedEncrypted.facts)).not.toContain('sealed-v1/');
        for (const version of facts.workspace.resourceVersions) {
          expect(await readFile(stagedEncrypted.files.get(`blobs/sha256/${version.digest}`)!))
            .toEqual(Buffer.from(await originalBlobs.read(version.blobRef, version.digest)));
        }
      } finally { await stagedEncrypted.dispose(); }
    } finally { await encryptedExport.dispose(); }
    const invalidIntermediate = structuredClone(portable);
    invalidIntermediate.journal.splice(1, 0, { ...structuredClone(portable.journal[0]), payload: { stateChanges: { messages: {} } } });
    expect(() => validatePortableHistory(invalidIntermediate, semanticStateChecksum)).toThrow('BUNDLE_INVALID_HISTORY_DELTA');
    for (const messages of [[null], [{}], [{ id: {} }], [{ id: '' }], [{ id: 'duplicate' }, { id: 'duplicate' }]]) {
      invalidIntermediate.journal[1].payload.stateChanges = { messages };
      expect(() => validatePortableHistory(invalidIntermediate, semanticStateChecksum)).toThrow('BUNDLE_INVALID_HISTORY_DELTA');
    }
    const forgedHistory = structuredClone(portable);
    forgedHistory.journal.at(-1)!.payload.stateChanges = { projectTitle: 'forged history' };
    expect(() => validatePortableHistory(forgedHistory, semanticStateChecksum)).toThrow('BUNDLE_EVENT_STATE_MISMATCH');
    forgedHistory.journal.forEach(event => { delete event.payload.portableStateChecksum; });
    expect(() => validatePortableHistory(forgedHistory, semanticStateChecksum)).toThrow('BUNDLE_HISTORY_MISMATCH');
    const forgedChecksum = structuredClone(portable);
    forgedChecksum.journal[0].payload.portableStateChecksum = '0'.repeat(64);
    expect(() => validatePortableHistory(forgedChecksum, semanticStateChecksum)).toThrow('BUNDLE_EVENT_STATE_MISMATCH');
    expect(() => portableWorkspaceFacts(forgedChecksum, input => semanticStateChecksum(input as Record<string, unknown>))).toThrow('BUNDLE_EVENT_STATE_MISMATCH');
    for (const index of [0, portable.journal.length - 1]) {
      const incomplete = structuredClone(portable);
      delete incomplete.journal[index].payload.portableStateChecksum;
      expect(() => validatePortableHistory(incomplete, semanticStateChecksum)).toThrow('BUNDLE_EVENT_CHECKSUM_MISSING');
    }
    expect(portableWorkspaceFacts(portable, input => semanticStateChecksum(input as Record<string, unknown>))).toEqual(portable);
    const invalidDelta = structuredClone(portable);
    invalidDelta.journal.at(-1)!.payload.stateChanges = { constructor: {} };
    expect(() => validatePortableHistory(invalidDelta, semanticStateChecksum)).toThrow('BUNDLE_INVALID_HISTORY_DELTA');
    const missing = structuredClone(portable);
    missing.runs = [];
    expect(() => validatePortableReferences(missing)).toThrow('BUNDLE_BROKEN_REFERENCES');
    const duplicate = structuredClone(portable);
    duplicate.workspace.messages.push(duplicate.workspace.messages[0]);
    expect(() => validatePortableReferences(duplicate)).toThrow('BUNDLE_DUPLICATE_MESSAGE');
    const duplicateOutput = structuredClone(portable);
    duplicateOutput.provenance.push({ ...duplicateOutput.provenance[0], id: 'another-link' });
    expect(() => validatePortableReferences(duplicateOutput)).toThrow('BUNDLE_DUPLICATE_OUTPUT_PROVENANCE');
    const wrongOutput = structuredClone(portable);
    wrongOutput.provenance[0].outputRef = wrongOutput.workspace.messages.find(message => message.kind === 'user')!.id;
    expect(() => validatePortableReferences(wrongOutput)).toThrow('BUNDLE_BROKEN_REFERENCES');
    const missingRevision = structuredClone(portable);
    missingRevision.provenance[0].parentRevisionRef = 'missing-parent';
    expect(() => validatePortableReferences(missingRevision)).toThrow('BUNDLE_BROKEN_REFERENCES');
    const download = await request(app).get(`/api/v1/workspaces/${facts.workspace.projectId}/bundle`).buffer(true).parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
      response.on('error', callback);
    }).expect(200);
    expect(download.headers['content-disposition']).toContain('workspace.rhiza');
    const path = join(uploadDirectory, 'download.rhiza'); await writeFile(path, download.body);
    const httpDatabase = new PGlite();
    cleanups.push(() => httpDatabase.close());
    for (const migration of await loadMigrations()) await httpDatabase.exec(migration.sql);
    const httpStore = new PostgresWorkspaceStore(httpDatabase, portable.workspace.projectId);
    const httpApp = createApp(httpStore, provider, false, runtime, undefined, join(uploadDirectory, 'http-import'));
    const preview = await request(httpApp).post('/api/bundle/preview').set('Content-Type', 'application/vnd.rhiza.workspace+zip').send(download.body).expect(200);
    expect(preview.body).toMatchObject({ workspaceId: portable.workspace.projectId, name: portable.directory.name,
      messages: portable.workspace.messages.length, runs: portable.runs.length, resourceVersions: portable.workspace.resourceVersions.length });
    expect(preview.body.archiveDigest).toMatch(/^[a-f0-9]{64}$/);
    expect((await httpDatabase.query('SELECT * FROM bundle_imports')).rows).toHaveLength(0);
    expect((await httpDatabase.query('SELECT * FROM rhiza_projects')).rows).toHaveLength(0);
    expect((await httpDatabase.query('SELECT * FROM command_receipts')).rows).toHaveLength(0);
    expect((await httpDatabase.query('SELECT * FROM workspace_events')).rows).toHaveLength(0);
    await request(httpApp).post('/api/bundle/preview').send({}).expect(415);
    const upload = () => request(httpApp).post('/api/bundle/import').set('Content-Type', 'application/vnd.rhiza.workspace+zip').set('Idempotency-Key', 'import-roundtrip').send(download.body);
    const uploaded = await upload().expect(201);
    expect(uploaded.body.workspaceId).toBe(portable.workspace.projectId);
    expect((await upload().expect(201)).body).toEqual(uploaded.body);
    const conflict = await request(httpApp).post('/api/bundle/import').set('Content-Type', 'application/vnd.rhiza.workspace+zip').send(download.body).expect(409);
    expect(conflict.body.error.code).toBe('BUNDLE_TARGET_EXISTS');
    await request(httpApp).post('/api/bundle/import').send({}).expect(415);
    const ready = await stagePortableWorkspace(path);
    const archiveRoot = join(uploadDirectory, 'retained-imports');
    const archives = new NodeImportArchiveStore(archiveRoot);
    await archives.retain(path, ready.archiveDigest);
    await archives.retain(path, ready.archiveDigest);
    const retained = JSON.parse(await readFile(join(archiveRoot, 'retained', `${ready.archiveDigest}.json`), 'utf8')) as { reference: { ciphertext: { blobRef: string } } };
    const encryptedArchive = await readFile(join(archiveRoot, 'blobs', ...retained.reference.ciphertext.blobRef.split('/')));
    expect(encryptedArchive.includes(download.body.subarray(0, 64))).toBe(false);
    const recoveredArchive = await new NodeImportArchiveStore(archiveRoot).stage(ready.archiveDigest);
    expect(recoveredArchive.facts).toEqual(ready.facts);
    await recoveredArchive.dispose();
    const legacyRoot = join(uploadDirectory, 'legacy-retained-imports');
    const legacyBlobDirectory = join(legacyRoot, 'blobs', 'sha256', ready.archiveDigest.slice(0, 2));
    const legacyBlobPath = join(legacyBlobDirectory, ready.archiveDigest);
    await mkdir(legacyBlobDirectory, { recursive: true });
    await copyFile(path, legacyBlobPath);
    const legacyArchives = new NodeImportArchiveStore(legacyRoot);
    expect(await legacyArchives.migrateLegacy(ready.archiveDigest)).toBe(true);
    await expect(stat(legacyBlobPath)).rejects.toMatchObject({ code: 'ENOENT' });
    const migratedArchive = await legacyArchives.stage(ready.archiveDigest);
    expect(migratedArchive.facts).toEqual(ready.facts);
    await migratedArchive.dispose();
    await copyFile(path, legacyBlobPath);
    expect(await legacyArchives.migrateLegacy(ready.archiveDigest)).toBe(true);
    await expect(stat(legacyBlobPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(archives.retain(path, '0'.repeat(64))).rejects.toThrow('BUNDLE_ARCHIVE_DIGEST_MISMATCH');
    await expect(archives.stage('../escape')).rejects.toThrow('BUNDLE_INVALID_ARCHIVE_DIGEST');
    expect(ready.facts).toEqual(JSON.parse(JSON.stringify(portable)));
    const destinationBlobs = new NodeFilesystemBlobStore(join(uploadDirectory, 'imported-blobs'));
    const checkpoints = new SqlBundleImportCheckpoints(database);
    const identity = { importId: randomUUID(), ownerId: 'import-owner', workspaceId: portable.workspace.projectId,
      archiveDigest: ready.archiveDigest, stateDigest: semanticStateChecksum({ facts: portable }) };
    await database.query(`INSERT INTO bundle_imports(import_id,owner_id,workspace_id,archive_digest,state_digest,updated_at)
      VALUES ($1,$2,$3,$4,$5,now() - interval '8 days')`,
    [randomUUID(), identity.ownerId, identity.workspaceId, identity.archiveDigest, identity.stateDigest]);
    expect(await new PostgresWorkspaceStore(database).retainedImportArchivePins()).not.toContain(identity.archiveDigest);
    const otherImportId = randomUUID();
    await database.query(`INSERT INTO bundle_imports(import_id,owner_id,workspace_id,archive_digest,state_digest)
      VALUES ($1,$2,$3,$4,$5)`,
    [otherImportId, identity.ownerId, identity.workspaceId, identity.archiveDigest, identity.stateDigest]);
    expect(await new PostgresWorkspaceStore(database).retainedImportArchivePins()).toContain(identity.archiveDigest);
    await database.query('DELETE FROM bundle_imports WHERE import_id=$1', [otherImportId]);
    expect(await new PostgresWorkspaceStore(database).retainedImportArchivePins()).not.toContain(identity.archiveDigest);
    const interruptedBlobs = new NodeFilesystemBlobStore(join(uploadDirectory, 'imported-blobs'), () => { throw new Error('ingest-interrupted'); });
    await expect(prepareBundleImport(identity, checkpoints, () => ingestPortableBlobs(ready, interruptedBlobs))).rejects.toThrow('ingest-interrupted');
    expect(await checkpoints.read(identity.importId, identity.ownerId)).toMatchObject({ phase: 'validated', revision: 1 });
    expect(await new PostgresWorkspaceStore(database).retainedImportArchivePins()).toContain(identity.archiveDigest);
    const prepared = await prepareBundleImport(identity, checkpoints, () => ingestPortableBlobs(ready, destinationBlobs));
    expect(prepared).toMatchObject({ phase: 'blobs-ready', revision: 2 });
    const retryVerification = vi.fn(() => ingestPortableBlobs(ready, destinationBlobs));
    expect(await prepareBundleImport(identity, checkpoints, retryVerification)).toEqual(prepared);
    expect(retryVerification).toHaveBeenCalledOnce();
    await expect(prepareBundleImport({ ...identity, archiveDigest: '0'.repeat(64) }, checkpoints, retryVerification)).rejects.toThrow('BUNDLE_IMPORT_CONFLICT');
    expect(retryVerification).toHaveBeenCalledOnce();
    const importedRefs = await ingestPortableBlobs(ready, destinationBlobs);
    expect(importedRefs.length).toBeGreaterThan(0);
    expect(await ingestPortableBlobs(ready, destinationBlobs)).toEqual(importedRefs);
    for (const version of portable.workspace.resourceVersions) await expect(destinationBlobs.read(version.blobRef, version.digest)).resolves.toHaveLength(version.size);
    const destinationPath = join(uploadDirectory, 'import-database');
    let destination = new PGlite(destinationPath);
    cleanups.push(() => destination.close());
    for (const migration of await loadMigrations()) await destination.exec(migration.sql);
    let target = new PostgresWorkspaceStore(destination, portable.workspace.projectId);
    let targetCheckpoints = new SqlBundleImportCheckpoints(destination);
    await prepareBundleImport(identity, targetCheckpoints, () => ingestPortableBlobs(ready, destinationBlobs));
    const occupiedProject = randomUUID();
    const occupiedNode = portable.workspace.discussionNodes[0].id;
    await destination.query('INSERT INTO rhiza_projects(id,title,state) VALUES ($1,$2,$3::jsonb)', [occupiedProject, 'Unrelated project', '{}']);
    await destination.query("INSERT INTO rhiza_nodes(id,project_id,title,summary,status,kind,position_x,position_y) VALUES ($1,$2,'Unrelated node','','active','main',0,0)", [occupiedNode, occupiedProject]);
    await expect(target.activatePortableImport(identity.importId, identity.ownerId, portable)).rejects.toThrow('BUNDLE_IDENTITY_COLLISION');
    expect((await destination.query<{ title: string }>('SELECT title FROM rhiza_nodes WHERE id=$1', [occupiedNode])).rows[0].title).toBe('Unrelated node');
    expect(await target.readExisting()).toBeUndefined();
    await destination.query('DELETE FROM rhiza_nodes WHERE id=$1', [occupiedNode]);
    await destination.query('DELETE FROM rhiza_projects WHERE id=$1', [occupiedProject]);
    await destination.exec(`CREATE FUNCTION fail_import_journal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'import-journal-interrupted'; END $$;
      CREATE TRIGGER fail_import_journal BEFORE INSERT ON workspace_events FOR EACH ROW EXECUTE FUNCTION fail_import_journal();`);
    await expect(target.activatePortableImport(identity.importId, identity.ownerId, portable)).rejects.toThrow('import-journal-interrupted');
    expect(await target.readExisting()).toBeUndefined();
    expect(await targetCheckpoints.read(identity.importId, identity.ownerId)).toMatchObject({ phase: 'blobs-ready' });
    await destination.exec('DROP TRIGGER fail_import_journal ON workspace_events; DROP FUNCTION fail_import_journal();');
    await destination.close();
    destination = new PGlite(destinationPath);
    target = new PostgresWorkspaceStore(destination, portable.workspace.projectId);
    targetCheckpoints = new SqlBundleImportCheckpoints(destination);
    expect(await targetCheckpoints.read(identity.importId, identity.ownerId)).toMatchObject({ phase: 'blobs-ready' });
    const resumedArchive = await new NodeImportArchiveStore(archiveRoot).stage(identity.archiveDigest);
    try {
      await completeBundleImport(identity, resumedArchive.facts, targetCheckpoints, () => ingestPortableWorkspace(resumedArchive, destinationBlobs), new RepositoryWorkspaceUnitOfWork(target));
    } finally { await resumedArchive.dispose(); }
    await target.activatePortableImport(identity.importId, identity.ownerId, portable);
    expect(await targetCheckpoints.read(identity.importId, identity.ownerId)).toMatchObject({ phase: 'activated', revision: 3 });
    const restored = portableWorkspaceFacts(await target.readPortableWorkspace(), input => semanticStateChecksum(input as Record<string, unknown>));
    expect(restored).toEqual(portable);
    expect((await target.readGraphProjection()).checksum).toBe((await store.readGraphProjection()).checksum);
    const importedApp = createApp(target, provider, false, runtime, undefined, join(uploadDirectory, 'imported-blobs'));
    const manifestId = portable.workspace.manifests.at(-1)!.id;
    const context = await request(importedApp).get(`/api/v1/workspaces/${portable.workspace.projectId}/context/manifests/${manifestId}`).expect(200);
    expect(context.body.sources.length).toBeGreaterThan(0);
    expect(context.body.sources.every((source: { status: string }) => source.status === 'resolved')).toBe(true);
    await request(importedApp).post(`/api/v1/workspaces/${portable.workspace.projectId}/chat`).send({ message: 'Continue imported conversation' }).expect(201);
    const originalRunId = portable.runs[0].id;
    await request(importedApp).post(`/api/v1/workspaces/${portable.workspace.projectId}/runs/${originalRunId}/replay`).send({ policy: 'exact' }).expect(409);
    const replay = await request(importedApp).post(`/api/v1/workspaces/${portable.workspace.projectId}/runs/${originalRunId}/replay`).send({ policy: 'partial' }).expect(201);
    expect(replay.body.replay.classification).toBe('partial');
    expect(await target.getRun(originalRunId)).toEqual(portable.runs[0]);
    const continued = await target.readPortableWorkspace();
    expect(continued.journal.length).toBeGreaterThan(portable.journal.length);
    expect(continued.journal.every((event, index) => event.sequence === index + 1)).toBe(true);
    const reexported = portableWorkspaceFacts(continued, input => semanticStateChecksum(input as Record<string, unknown>));
    expect(reexported.journal.slice(0, portable.journal.length).map(event => event.payload.portableStateChecksum))
      .toEqual(portable.journal.map(event => event.payload.portableStateChecksum));
    expect(reexported.journal.every(event => typeof event.payload.portableStateChecksum === 'string')).toBe(true);
    expect(() => validatePortableHistory(reexported, semanticStateChecksum)).not.toThrow();
    await ready.dispose();
    await expect(readFile(join(ready.directory, 'index.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stagePortableWorkspace(path, { ...BUNDLE_LIMITS, maxDocumentBytes: 16 })).rejects.toThrow('BUNDLE_QUOTA_EXCEEDED');
    const staged = await stageBundleArchive(path);
    try {
      const document = JSON.parse(await readFile(staged.files.get(staged.index.root)!, 'utf8'));
      const ajv = new Ajv2020({ strict: true });
      addFormats(ajv); ajv.addSchema(journalSchema);
      const validate = ajv.compile(portableWorkspaceSchema);
      expect(validate(document), JSON.stringify(validate.errors)).toBe(true);
      expect(decodePortableDocument(document, staged.index)).toEqual(document.facts);
      const malformedFields = structuredClone(document);
      malformedFields.facts.journal[0].payload.snapshot.state.messages = [{ id: 'valid-id', text: {} }];
      expect(() => decodePortableDocument(malformedFields, staged.index)).toThrow('BUNDLE_INVALID_HISTORY_DELTA');
      for (const payload of [{ removedObject: null }, { removedRelation: { source: {} } }, { removedRelations: [null] }]) {
        const invalidHistory = structuredClone(document);
        Object.assign(invalidHistory.facts.journal[0].payload, payload);
        expect(() => decodePortableDocument(invalidHistory, staged.index)).toThrow('BUNDLE_INVALID_DOCUMENT');
      }
      const malformed = structuredClone(document);
      malformed.facts.runs[0].input.request.history = {};
      expect(validate(malformed)).toBe(false);
      expect(() => decodePortableDocument(malformed, staged.index)).toThrow('BUNDLE_INVALID_DOCUMENT');
      const secret = structuredClone(document);
      secret.providerEndpoints[0].apiKey = 'forbidden';
      expect(validate(secret)).toBe(false);
      expect(() => decodePortableDocument(secret, staged.index)).toThrow('BUNDLE_INVALID_DOCUMENT');
      const swappedModel = structuredClone(document);
      swappedModel.modelSpecs[0].model = 'different-model';
      expect(() => decodePortableDocument(swappedModel, staged.index)).toThrow('BUNDLE_DESCRIPTOR_MISMATCH');
      const duplicateDescriptor = structuredClone(document);
      duplicateDescriptor.runtimeSnapshots.push(duplicateDescriptor.runtimeSnapshots[0]);
      expect(() => decodePortableDocument(duplicateDescriptor, staged.index)).toThrow('BUNDLE_DESCRIPTOR_MISMATCH');
      expect(document.facts).toEqual(JSON.parse(JSON.stringify(portable)));
      expect(document.providerEndpoints.every((endpoint: { credential_required: boolean }) => endpoint.credential_required)).toBe(true);
      expect(document.runtimeSnapshots).toHaveLength(1);
      expect(() => validatePortableContent(portable, staged.index)).not.toThrow();
      expect(() => validatePortableContent(portable, { ...staged.index, workspaceId: randomUUID() })).toThrow('BUNDLE_WORKSPACE_MISMATCH');
      const missingContent = { ...staged.index, entries: staged.index.entries.filter(entry => !entry.path.startsWith('blobs/')) };
      expect(() => validatePortableContent(portable, missingContent)).toThrow('BUNDLE_MISSING_CONTENT');
      const forgedInput = structuredClone(portable);
      forgedInput.runs[0].input.request.prompt = 'tampered after export';
      expect(() => validatePortableContent(forgedInput, staged.index)).toThrow('BUNDLE_RUNTIME_DIGEST_MISMATCH');
      const wrongSize = structuredClone(portable);
      wrongSize.workspace.resourceVersions[0].size += 1;
      expect(() => validatePortableContent(wrongSize, staged.index)).toThrow('BUNDLE_SIZE_MISMATCH');
      expect(staged.files.has('schemas/bundle-index-v1.json')).toBe(true);
      const rootPath = staged.files.get(staged.index.root)!;
      const foreignOwner = structuredClone(document);
      const foreignUser = randomUUID();
      foreignOwner.facts.directory.createdBy = foreignUser;
      foreignOwner.facts.members = [{ userId: foreignUser, role: 'owner' }];
      await writeFile(rootPath, JSON.stringify(foreignOwner));
      const foreignIndex = { ...staged.index, entries: await Promise.all(staged.index.entries.map(entry => entry.path === staged.index.root
        ? describeBundleFile(rootPath, entry.path, entry.mediaType) : entry)) };
      const foreignPath = join(uploadDirectory, 'foreign-owner.rhiza');
      await writeBundleArchive(foreignIndex, staged.files, foreignPath);
      const forbidden = await request(httpApp).post('/api/bundle/import').set('Content-Type', 'application/vnd.rhiza.workspace+zip').send(await readFile(foreignPath)).expect(403);
      expect(forbidden.body.error.code).toBe('BUNDLE_IMPORT_FORBIDDEN');
      const forbiddenPreview = await request(httpApp).post('/api/bundle/preview').set('Content-Type', 'application/vnd.rhiza.workspace+zip').send(await readFile(foreignPath)).expect(403);
      expect(forbiddenPreview.body.error.code).toBe('BUNDLE_IMPORT_FORBIDDEN');
      for (const [name, content, code] of [
        ['syntax', Buffer.from('{invalid json'), 'BUNDLE_INVALID_DOCUMENT'],
        ['utf8', Buffer.from([0x22, 0xff, 0x22]), 'BUNDLE_INVALID_DOCUMENT'],
        ['prototype', Buffer.from('{"__proto__":{}}'), 'BUNDLE_INVALID_DOCUMENT'],
        ['depth', Buffer.from('['.repeat(130) + '0' + ']'.repeat(130)), 'BUNDLE_DOCUMENT_TOO_DEEP'],
      ] as const) {
        await writeFile(rootPath, content);
        const badIndex = { ...staged.index, entries: await Promise.all(staged.index.entries.map(entry => entry.path === staged.index.root
          ? describeBundleFile(rootPath, entry.path, entry.mediaType) : entry)) };
        const badArchive = join(uploadDirectory, `invalid-document-${name}.rhiza`);
        await writeBundleArchive(badIndex, staged.files, badArchive);
        await expect(stagePortableWorkspace(badArchive)).rejects.toThrow(code);
      }
    } finally { await staged.dispose(); }
    expect(await store.readPortableWorkspace()).toEqual(facts);
  });
  it('M09 replays frozen inputs explicitly, deduplicates dispatch and refuses missing resources', async () => {
    const requests: RuntimeRequest[] = [];
    const { app, store, runtime } = await setup(async function* (input) { requests.push(structuredClone({ ...input, signal: undefined })); yield* success(input); });
    const originalResponse = await request(app).post('/api/chat').send({ message: 'original frozen question' }).expect(201);
    const [original] = await store.listRuns();
    const planner = vi.spyOn(PostgresWorkspaceStore.prototype, 'queryContextCandidates');
    try {
      const url = `/api/v1/workspaces/${original.workspaceId}/runs/${original.id}/replay`;
      const replayed = await request(app).post(url).set('Idempotency-Key', 'replay-once').send({ policy: 'exact' }).expect(201);
      const repeated = await request(app).post(url).set('Idempotency-Key', 'replay-once').send({ policy: 'exact' }).expect(201);
      expect(repeated.body).toEqual(replayed.body);
      expect(requests).toHaveLength(2);
      expect(requests[1]).toMatchObject({ prompt: original.input.request.prompt, history: original.input.request.history, contextItems: original.input.request.contextItems });
      expect(replayed.body.manifest.contextItems).toEqual(originalResponse.body.manifest.contextItems);
      expect(replayed.body.replay).toMatchObject({ classification: 'exact', sourceRunRef: original.id });
      const models = vi.spyOn(runtime, 'listModels').mockResolvedValue([{ ...model, endpointVersion: 'changed' }]);
      const refused = await request(app).post(url).send({ policy: 'exact' }).expect(409);
      expect(refused.body.error.code).toBe('REPLAY_CONTRACT_CHANGED');
      expect(requests).toHaveLength(2);
      const partial = await request(app).post(url).send({ policy: 'partial' }).expect(201);
      expect(partial.body.replay.classification).toBe('partial');
      models.mockResolvedValue([{ ...model, id: 'new-model', model: 'new-model' }]);
      const current = await request(app).post(url).send({ policy: 'current-model' }).expect(201);
      expect(current.body.replay.classification).toBe('current-model');
      expect(requests.at(-1)?.modelId).toBe('new-model');
      expect(requests.at(-1)?.prompt).toBe(original.input.request.prompt);
      const blobRead = vi.spyOn(NodeEncryptedBlobStore.prototype, 'read').mockRejectedValue(Object.assign(new Error('missing'), { reason: 'missing_blob' }));
      try {
        const missing = await request(app).post(url).send({ policy: 'current-model' }).expect(409);
        expect(missing.body.error.code).toBe('REPLAY_MISSING_RESOURCE');
        expect(requests).toHaveLength(4);
      } finally { blobRead.mockRestore(); }
      expect(planner).not.toHaveBeenCalled();
      expect(await store.getRun(original.id)).toEqual(original);
    } finally { planner.mockRestore(); }
  });
  it('commits terminal, messages and immutable input together; regenerate creates a child; retries deduplicate external calls', async () => {
    let calls = 0;
    const { app, store, database } = await setup(async function* (input) { calls++; yield* success(input); });
    const initial = await store.read();
    const response = await request(app).post('/api/chat').set('Idempotency-Key', 'same-command').set('If-Match', '1').send({ message: 'hello' }).expect(201);
    await request(app).post('/api/chat').set('Idempotency-Key', 'same-command').set('If-Match', '1').send({ message: 'hello' }).expect(201);
    expect(calls).toBe(1);
    const [run] = await store.listRuns();
    expect(run.status).toBe('completed');
    expect(run.inputHash).toBe(semanticStateChecksum(run.input as unknown as Record<string, unknown>));
    expect(JSON.stringify(run)).not.toContain('secret-never-in-run');
    expect((await store.read()).messages.length).toBe(initial.messages.length + 2);
    const provenance = await request(app).get(`/api/v1/workspaces/${initial.projectId}/objects/${response.body.assistantMessage.id}/provenance`).expect(200);
    expect(provenance.body).toMatchObject({ status: 'recorded', runRef: run.id, outputRef: response.body.assistantMessage.id,
      contextManifestRef: response.body.manifest.id, modelSpecRef: run.input.executor.modelSpecRef, providerEndpointRef: run.input.executor.providerEndpointRef });
    expect(provenance.body.inputRefs).toContain(response.body.userMessage.id);
    expect(await store.readProvenance(response.body.assistantMessage.id)).toEqual(provenance.body);
    const other = await request(app).post('/api/v1/workspaces').send({ name: 'Provenance isolation' }).expect(201);
    await request(app).get(`/api/v1/workspaces/${other.body.workspace.workspaceId}/objects/${response.body.assistantMessage.id}/provenance`).expect(404);
    await expect(database.query("UPDATE execution_runs SET input_envelope='{}' WHERE run_id=$1", [run.id])).rejects.toThrow(/immutable/);
    await expect(database.query("UPDATE execution_runs SET status='running' WHERE run_id=$1", [run.id])).rejects.toThrow(/immutable/);
    await request(app).post('/api/chat').send({ message: 'regenerate', operation: 'regenerate', sourceMessageId: response.body.assistantMessage.id }).expect(201);
    const child = (await store.listRuns()).find(item => item.id !== run.id)!;
    expect(child.parentRunRef).toBe(run.id);
    expect(await store.getRun(run.id)).toEqual(run);
  });

  it('M08 freezes real context versions before provider dispatch and enforces Manifest v1 in the database', async () => {
    let observedVersions = 0;
    const { app, store, database, uploadDirectory } = await setup(async function* (input) {
      observedVersions = Number((await database.query<{ count: string }>("SELECT count(*) AS count FROM rhiza_resource_versions rv JOIN rhiza_resources r ON r.resource_id=rv.resource_id WHERE r.kind='context-source'")).rows[0].count);
      yield* success(input);
    });
    const uploaded = await request(app).post('/api/attachments').send({ name: 'evidence.txt', mimeType: 'text/plain', dataBase64: Buffer.from('freeze exact evidence payment '.repeat(200)).toString('base64') }).expect(201);
    const attachment = uploaded.body.attachment;
    const response = await request(app).post('/api/chat').send({ message: 'freeze exact evidence', attachmentIds: [attachment.id] }).expect(201);
    const manifest = response.body.manifest as import('../server/domain').ContextManifest;
    expect(manifest.schemaVersion).toBe('1.0.0');
    expect(observedVersions).toBe(manifest.contextItems.length);
    expect(observedVersions).toBeGreaterThan(0);
    expect(new Set(manifest.contextItems.map(item => item.sourceType))).toEqual(new Set(['node', 'segment', 'reference', 'file', 'chunk']));
    const workspace = await store.read();
    const rawBlobs = new NodeFilesystemBlobStore(uploadDirectory);
    const blobs = new NodeEncryptedBlobStore(new NodeSealedContentStore(
      rawBlobs,
      new NodeContentKeys(join(uploadDirectory, 'resource-keys')),
    ), rawBlobs);
    const [run] = await store.listRuns();
    for (const [index, item] of manifest.contextItems.entries()) {
      const version = workspace.resourceVersions.find(version => version.id === item.resourceVersionId)!;
      expect(version).toMatchObject({ resourceId: item.resourceId, digest: item.digest });
      expect(item.priority).toBe(index);
      expect(item.contributorVersion).toBe('lexical-v1');
      if (item.sourceType === 'file' || item.sourceType === 'chunk') expect(item).toMatchObject({ originResourceVersionId: attachment.resourceVersionId, originDigest: attachment.digest });
      expect(JSON.parse(new TextDecoder().decode(await blobs.read(version.blobRef, version.digest))).content).toBe(run.input.request.contextItems[index].content);
    }
    const planner = vi.spyOn(PostgresWorkspaceStore.prototype, 'queryContextCandidates');
    const historical = await request(app).get(`/api/context/manifests/${manifest.id}`).expect(200);
    expect(historical.body.sources.every((source: { status: string }) => source.status === 'resolved')).toBe(true);
    await store.update(current => ({ ...current, discussionNodes: current.discussionNodes.map(node => node.id === current.activeNodeId ? { ...node, summary: 'Changed after generation', status: 'archived' as const } : node) }));
    const afterArchive = await request(app).get(`/api/context/manifests/${manifest.id}`).expect(200);
    expect(afterArchive.body).toEqual(historical.body);
    for (const message of [response.body.userMessage, response.body.assistantMessage]) {
      const fromMessage = await request(app).get(`/api/messages/${message.id}/context`).expect(200);
      expect(fromMessage.body).toEqual(historical.body);
    }
    expect(planner).not.toHaveBeenCalled();
    planner.mockRestore();
    await expect(database.query("UPDATE rhiza_context_manifests SET manifest='{}' WHERE id=$1", [manifest.id])).rejects.toThrow(/immutable/);
    await expect(database.query('DELETE FROM rhiza_context_manifests WHERE id=$1', [manifest.id])).rejects.toThrow(/immutable/);
    await database.query("SET rhiza.purge_context_manifest_delete='on'");
    await expect(database.query('DELETE FROM rhiza_context_manifests WHERE id=$1', [manifest.id])).rejects.toThrow(/immutable/);
    await database.query("SET rhiza.purge_context_manifest_delete='off'");
    const forged = { ...manifest, contextItems: manifest.contextItems.map(item => ({ ...item, digest: '0'.repeat(64) })) };
    await expect(database.query('INSERT INTO rhiza_context_manifests (id,project_id,node_id,request_id,mode,provider,model,runtime,estimated_tokens,manifest,created_at) SELECT $2,project_id,node_id,$3,mode,provider,model,runtime,estimated_tokens,$4::jsonb,created_at FROM rhiza_context_manifests WHERE id=$1', [manifest.id, randomUUID(), randomUUID(), JSON.stringify(forged)])).rejects.toThrow(/ResourceVersion/);
  });

  it('records provider errors and missing RUN_END without adding messages', async () => {
    let calls = 0;
    const { app, store } = await setup(async function* (input) {
      if (calls++ === 0) yield { type: 'RUN_ERROR', requestId: input.requestId, code: 'PROVIDER_TIMEOUT', message: 'secret-never-in-run', status: 504 };
    });
    const before = (await store.read()).messages;
    await request(app).post('/api/chat').send({ message: 'timeout' }).expect(504);
    await request(app).post('/api/chat').send({ message: 'disconnect' }).expect(502);
    const runs = await store.listRuns();
    expect(runs.map(run => run.status).sort()).toEqual(['failed', 'interrupted']);
    expect(runs.find(run => run.status === 'failed')?.error?.class).toBe('timeout');
    expect((await store.read()).messages).toEqual(before);
    expect(JSON.stringify(runs)).not.toContain('secret-never-in-run');
  });

  it('cancels an uncooperative running provider durably and rejects late output', async () => {
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const { app, store } = await setup(async function* (input) { entered(); await held; yield* success(input); });
    const before = (await store.read()).messages;
    const running = request(app).post('/api/chat').send({ message: 'cancel this' }).then(response => response);
    await enteredPromise;
    const [run] = await store.listRuns();
    expect(run.status).toBe('running');
    const canceled = await request(app).post(`/api/v1/runs/${run.id}/cancel`).send({ workspaceId: run.workspaceId }).expect(200);
    expect(canceled.body.run.status).toBe('canceled');
    expect((await running).status).toBe(499);
    release();
    await new Promise(resolve => setImmediate(resolve));
    expect((await store.getRun(run.id))?.status).toBe('canceled');
    expect((await store.read()).messages).toEqual(before);
    await request(app).post(`/api/runs/${run.id}/cancel`).expect(200);
  });

  it.each(['created', 'dispatching', 'running'] as const)('cancels during %s before any external call', async status => {
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    const { app, store } = await setup(async function* (input) { calls++; yield* success(input); });
    const execute = store.executeCommand.bind(store);
    store.executeCommand = async command => {
      const result = await execute(command);
      const mutation = command.options?.run;
      if ((status === 'created' && mutation?.kind === 'create') || (status !== 'created' && mutation?.kind === 'transition' && mutation.patch.status === status)) { entered(); await hold; }
      return result;
    };
    const running = request(app).post('/api/chat').send({ message: 'cancel before dispatch' }).then(response => response);
    await ready;
    const [run] = await store.listRuns();
    await request(app).post(`/api/runs/${run.id}/cancel`).expect(200);
    release();
    await running;
    expect(calls).toBe(0);
    expect((await store.getRun(run.id))?.status).toBe('canceled');
  });

  it('rolls back a successful terminal transition when message persistence fails', async () => {
    const { app, database, store } = await setup(success);
    const before = (await store.read()).messages;
    await database.exec(`CREATE FUNCTION fail_run_message() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected message failure'; END $$;
      CREATE TRIGGER fail_run_message BEFORE INSERT ON rhiza_messages FOR EACH ROW EXECUTE FUNCTION fail_run_message();`);
    await request(app).post('/api/chat').send({ message: 'cannot commit' }).expect(500);
    const [run] = await store.listRuns();
    expect(run.status).toBe('failed');
    expect(run.error?.class).toBe('commit');
    expect((await store.read()).messages).toEqual(before);
    expect((await store.readJournal()).some(event => event.eventType === 'conversation.run.committed')).toBe(false);
  });

  it('keeps archive available but rejects purge while immutable Run input retains the node', async () => {
    const { app, store } = await setup(success);
    await request(app).post('/api/chat').send({ message: 'retain provenance' }).expect(201);
    const [run] = await store.listRuns();
    await request(app).post('/api/graph/nodes').send({ title: 'Other node' }).expect(201);
    await request(app).patch(`/api/nodes/${run.nodeId}/status`).send({ status: 'archived' }).expect(200);
    const response = await request(app).post(`/api/graph/nodes/${run.nodeId}/purge`).send({ confirmation: `PURGE ${run.nodeId}`, reason: 'remove' }).expect(409);
    expect(response.body.error.code).toBe('PURGE_HAS_EXECUTION_HISTORY');
    expect((await store.read()).discussionNodes.some(node => node.id === run.nodeId)).toBe(true);
    expect(await store.getRun(run.id)).toEqual(run);
  });

  it('rejects cross-workspace reads/cancels and unrelated retry parents', async () => {
    const { app, store } = await setup(success);
    await request(app).post('/api/chat').send({ message: 'one' }).expect(201);
    const [run] = await store.listRuns();
    const created = await request(app).post('/api/v1/workspaces').send({ name: 'Other' }).expect(201);
    const scope = `/api/v1/workspaces/${created.body.workspace.workspaceId}`;
    await request(app).get(`${scope}/runs/${run.id}`).expect(404);
    await request(app).post(`${scope}/runs/${run.id}/cancel`).expect(404);
    await request(app).post(`${scope}/chat`).send({ message: 'retry', parentRunRef: run.id, operation: 'retry' }).expect(400);
  });

  it('stores 10k traces outside the Domain Journal and tracks temporary calls', async () => {
    const { app, store, database } = await setup(async function* (input) {
      for (let i = 0; i < 10000; i++) yield { type: 'CONTENT_DELTA', requestId: input.requestId, delta: 'x' };
      yield* success(input);
    });
    const before = await store.read();
    await request(app).post('/api/temp-chat').send({ message: 'temporary', sourceNodeId: before.activeNodeId, anchorText: 'anchor' }).expect(201);
    const [run] = await store.listRuns();
    expect(run.status).toBe('completed');
    expect(run.telemetry.traceCount).toBe(10001);
    expect((await database.query<{ count: number }>('SELECT count(*)::int count FROM execution_run_traces')).rows[0].count).toBe(10001);
    const attemptedTrace = { sequence: 10002, type: 'RUN_END', at: new Date().toISOString(), delta: 'must not persist' };
    await store.writeRunTraces(run.id, run.attempt, [attemptedTrace]);
    const storedTrace = await database.query<{ record: Record<string, unknown> }>('SELECT record FROM execution_run_traces WHERE run_id=$1 AND sequence=$2', [run.id, attemptedTrace.sequence]);
    expect(storedTrace.rows[0].record).toEqual({ sequence: attemptedTrace.sequence, type: attemptedTrace.type, at: attemptedTrace.at });
    expect((await store.readJournal()).length).toBeLessThanOrEqual(10);
    expect((await store.read()).messages).toEqual(before.messages);
  });

  it.each(['created', 'dispatching', 'running'] as const)('reconciles a process crash in %s without replaying the provider', async status => {
    const { app, store, database } = await setup(success);
    await request(app).post('/api/chat').send({ message: 'seed input' }).expect(201);
    const [completed] = await store.listRuns();
    const run: ExecutionRun = { ...completed, id: randomUUID(), commandId: randomUUID(), status, terminalAt: undefined };
    // Simulate the durable pre-crash row at each supported nonterminal checkpoint.
    await database.query(`INSERT INTO execution_runs (run_id,workspace_id,command_id,node_id,status,attempt,input_envelope,input_hash,model_spec_ref,provider_endpoint_ref,record)
      VALUES ($1,$2,$3,$4,$5,1,$6::jsonb,$7,$8,$9,$10::jsonb)`, [run.id, run.workspaceId, run.commandId, run.nodeId, status, JSON.stringify(run.input), run.inputHash, model.id, model.providerEndpointRef, JSON.stringify(run)]);
    const reopened = new PostgresWorkspaceStore(database);
    expect(await reopened.reconcileRuns()).toBe(1);
    expect(await reopened.reconcileRuns()).toBe(0);
    expect((await reopened.getRun(run.id))?.status).toBe('interrupted');
    expect((await request(app).get(`/api/runs/${run.id}`).expect(200)).body.run.error.code).toBe('PROCESS_INTERRUPTED');
  });
});

}
