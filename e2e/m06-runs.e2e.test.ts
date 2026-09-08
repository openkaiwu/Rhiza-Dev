// @vitest-environment node
import { Pool } from 'pg';
import type { SqlQueryable } from '../server/postgres-store';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
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
import { semanticStateChecksum } from '../server/infrastructure/workspace-semantic-checksum';
import { portableWorkspaceFacts } from '../server/application/portable-workspace';
import { validatePortableReferences } from '../server/application/portable-references';
import { stageBundleArchive, describeBundleFile, writeBundleArchive } from '../server/infrastructure/bundle-archive';
import { decodePortableDocument, ingestPortableBlobs, stagePortableWorkspace, validatePortableContent } from '../server/infrastructure/portable-content';
import { BUNDLE_LIMITS } from '../server/domain/portable-bundle';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { portableWorkspaceSchema } from '../server/domain/portable-workspace-schema';
import journalSchema from '../server/contracts/domain-event-envelope.schema.json';
import { validatePortableHistory } from '../server/application/portable-history';
import { SqlBundleImportCheckpoints } from '../server/infrastructure/bundle-import-checkpoints';
import { prepareBundleImport } from '../server/application/prepare-bundle-import';

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
  await request(app).get('/api/workspace').expect(200);
  await store.backfillJournal();
  return { database, store, app, runtime, uploadDirectory: join(directory, 'uploads') };
}
async function* success(input: RuntimeRequest) {
  yield { type: 'RUN_END' as const, requestId: input.requestId, text: 'answer', model: 'same-model', provider: 'Provider' };
}

for (const backend of ['embedded', 'postgres'] as const) {
describe.skipIf(backend === 'postgres' && !process.env.DATABASE_URL)(`M06 durable Chat execution (${backend})`, () => {
  const setup = (generate: AIRuntime['generate']) => fixture(generate, backend);
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
    const { app, store, uploadDirectory, database } = await setup(success);
    await request(app).post('/api/chat').send({ message: 'portable history' }).expect(201);
    const facts = await store.readPortableWorkspace();
    expect(facts.runs).toHaveLength(1);
    expect(facts.journal[0].sequence).toBe(1);
    expect(facts.provenance.length).toBe(facts.workspace.messages.filter(message => message.kind === 'assistant').length);
    const portable = portableWorkspaceFacts(facts, input => semanticStateChecksum(input as Record<string, unknown>));
    expect(() => validatePortableReferences(portable)).not.toThrow();
    expect(() => validatePortableHistory(portable, semanticStateChecksum)).not.toThrow();
    const forgedHistory = structuredClone(portable);
    forgedHistory.journal.at(-1)!.payload.stateChanges = { projectTitle: 'forged history' };
    expect(() => validatePortableHistory(forgedHistory, semanticStateChecksum)).toThrow('BUNDLE_HISTORY_MISMATCH');
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
    const ready = await stagePortableWorkspace(path);
    expect(ready.facts).toEqual(JSON.parse(JSON.stringify(portable)));
    const destinationBlobs = new NodeFilesystemBlobStore(join(uploadDirectory, 'imported-blobs'));
    const checkpoints = new SqlBundleImportCheckpoints(database);
    const identity = { importId: randomUUID(), ownerId: 'import-owner', workspaceId: portable.workspace.projectId,
      archiveDigest: ready.archiveDigest, stateDigest: semanticStateChecksum({ facts: portable }) };
    const interruptedBlobs = new NodeFilesystemBlobStore(join(uploadDirectory, 'imported-blobs'), () => { throw new Error('ingest-interrupted'); });
    await expect(prepareBundleImport(identity, checkpoints, () => ingestPortableBlobs(ready, interruptedBlobs))).rejects.toThrow('ingest-interrupted');
    expect(await checkpoints.read(identity.importId, identity.ownerId)).toMatchObject({ phase: 'validated', revision: 1 });
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
      const blobRead = vi.spyOn(NodeFilesystemBlobStore.prototype, 'read').mockRejectedValue(Object.assign(new Error('missing'), { reason: 'missing_blob' }));
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
    const blobs = new NodeFilesystemBlobStore(uploadDirectory);
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
