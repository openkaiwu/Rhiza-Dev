// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import { ProviderService } from '../server/provider-service';
import { ProviderStore } from '../server/provider-store';
import { SecretVault } from '../server/secret-vault';
import { NodePortableBundle } from '../server/infrastructure/portable-bundle';
import { portableWorkspaceFacts } from '../server/application/portable-workspace';
import { semanticStateChecksum } from '../server/infrastructure/workspace-semantic-checksum';
import { inspectM10Store } from '../scripts/m10-inspection';
import type { PortableWorkspaceFacts } from '../server/application/ports/portable-workspace';
import type { SqlQueryable } from '../server/postgres-store';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { LOCAL_USER_ID } from '../server/identity/workspace-scope';
import { NodeEncryptedBlobStore } from '../server/infrastructure/node-encrypted-blob-store';
import { NodeImportArchiveStore } from '../server/infrastructure/portable-content';

function appFor(store: Awaited<ReturnType<typeof openEmbeddedWorkspaceStore>>, root: string) {
  const provider = new ProviderService(new ProviderStore(join(root, 'providers')), new SecretVault(join(root, 'key')), { baseUrl: 'https://example.test', apiKey: '', model: 'fixture', providerName: 'Fixture', chatPath: '/chat', timeoutMs: 1000, temperature: 0, extraHeaders: {}, allowNoKey: true });
  return createApp(store, provider, false, { kind: 'provider-adapter', listModels: async () => [{ id: 'fixture', model: 'fixture', provider: 'Fixture', displayName: 'Fixture', active: true, providerEndpointRef: 'fixture-endpoint' }],
    async *generate(input) { yield { type: 'RUN_END', requestId: input.requestId, text: 'Offline backup fixture', model: 'fixture', provider: 'Fixture', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }; } }, undefined, join(root, 'uploads'));
}
const factsHash = (facts: PortableWorkspaceFacts) => semanticStateChecksum({ facts: portableWorkspaceFacts(facts, value => semanticStateChecksum(value as Record<string, unknown>)) });
const archiveBuffer = (response: request.Response, callback: (error: Error | null, value?: Buffer) => void) => {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk)); response.on('end', () => callback(null, Buffer.concat(chunks))); response.on('error', callback);
};

it('durably starts a scoped backup once, preserves failure, and interrupts unfinished work on restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-managed-backup-'));
  const archives = new NodeImportArchiveStore(join(root, 'uploads', 'imports'));
  const blobs = NodeEncryptedBlobStore.atDirectory(join(root, 'uploads'));
  let store = await openEmbeddedWorkspaceStore(join(root, 'db'), undefined, 'apply', blobs, archives);
  try {
    await store.read();
    await store.workspaceDirectory.ensureWorkspace({ workspaceId: store.defaultWorkspaceId, name: 'Backup fixture', status: 'active', createdBy: LOCAL_USER_ID, revision: 1 });
    await store.backfillJournal();
    const context = { commandId: randomUUID(), commandType: 'CreateManagedBackup', actor: { actorType: 'human' as const, actorId: LOCAL_USER_ID },
      scope: { scopeType: 'workspace' as const, scopeId: store.defaultWorkspaceId }, occurredAt: new Date().toISOString() };
    const first = await store.managedBackups.begin(context);
    expect(first.record.status).toBe('running');
    expect(first.facts?.workspace.projectId).toBe(store.defaultWorkspaceId);
    expect((await store.managedBackups.begin(context)).facts).toBeUndefined();
    await expect(store.managedBackups.begin({ ...context, actor: { ...context.actor, actorId: randomUUID() } })).rejects.toMatchObject({ code: 'WORKSPACE_OWNER_REQUIRED' });
    await store.managedBackups.fail(context, 'BACKUP_FAILED');
    expect((await store.managedBackups.begin(context)).record).toMatchObject({ status: 'failed', errorCode: 'BACKUP_FAILED' });
    const retry = { ...context, commandId: randomUUID() };
    await store.managedBackups.begin(retry, context.commandId);
    await store.close();
    store = await openEmbeddedWorkspaceStore(join(root, 'db'), undefined, 'verify', blobs, archives);
    expect(await store.interruptManagedBackups()).toBe(1);
    expect((await store.managedBackups.list(LOCAL_USER_ID)).backups).toEqual(expect.arrayContaining([
      expect.objectContaining({ backupId: retry.commandId, status: 'interrupted', retryOf: context.commandId }),
      expect.objectContaining({ backupId: context.commandId, status: 'failed' }),
    ]));
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});

it('managed backup HTTP retains encrypted full history past the import window and restores a clean store idempotently', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-managed-backup-roundtrip-'));
  const sourceRoot = join(root, 'source'); const targetRoot = join(root, 'target');
  const archives = new NodeImportArchiveStore(join(sourceRoot, 'uploads', 'imports'));
  const store = await openEmbeddedWorkspaceStore(join(sourceRoot, 'db'), undefined, 'apply', NodeEncryptedBlobStore.atDirectory(join(sourceRoot, 'uploads')), archives);
  const target = await openEmbeddedWorkspaceStore(join(targetRoot, 'db'), undefined, 'apply', NodeEncryptedBlobStore.atDirectory(join(targetRoot, 'uploads')), new NodeImportArchiveStore(join(targetRoot, 'uploads', 'imports')));
  try {
    const app = appFor(store, sourceRoot); await request(app).get('/api/workspace').expect(200); await store.backfillJournal();
    const upload = await request(app).post('/api/attachments').send({ name: 'fixture.txt', mimeType: 'text/plain', dataBase64: Buffer.from('Durable backup attachment').toString('base64') }).expect(201);
    await request(app).post('/api/chat').send({ message: 'Verify attachment history', attachmentIds: [upload.body.attachment.id] }).expect(201);
    const before = factsHash(await store.readPortableWorkspace()); const journal = await store.readJournal();
    expect((await request(app).get('/api/backups').expect(200)).body.reminder.due).toBe(true);
    const created = (await request(app).post('/api/backups').set('Idempotency-Key', 'backup-once').send({ ownerId: randomUUID() }).expect(201)).body;
    expect(created).toMatchObject({ status: 'ready', ownerId: LOCAL_USER_ID, archiveDigest: expect.stringMatching(/^[a-f0-9]{64}$/), stateDigest: before });
    expect(created.location).toMatch(/^managed:\/\//); expect(created.completedAt).toBeTruthy();
    expect((await request(app).post('/api/backups').set('Idempotency-Key', 'backup-once').send({}).expect(201)).body).toEqual(created);
    expect((await request(app).get('/api/backups').expect(200)).body.reminder.due).toBe(false);
    expect(factsHash(await store.readPortableWorkspace())).toBe(before); expect(await store.readJournal()).toEqual(journal);
    const pins = await store.retainedImportArchivePins(); expect(pins.has(created.archiveDigest)).toBe(true);
    expect(await archives.reclaim(pins, 0, Date.now() + 30 * 86400000)).toMatchObject({ released: 0, retained: 1 });
    const download = await request(app).get(`/api/backups/${encodeURIComponent(created.backupId)}/archive`).buffer(true).parse(archiveBuffer).expect(200);
    expect(download.body.length).toBe(created.sizeBytes);
    await request(app).get(`/api/v1/workspaces/${randomUUID()}/backups/${encodeURIComponent(created.backupId)}/archive`).expect(403);
    const importedApp = appFor(target, targetRoot);
    await request(importedApp).post('/api/bundle/preview').set('Content-Type', 'application/vnd.rhiza.workspace+zip').send(download.body).expect(200);
    await request(importedApp).post('/api/bundle/import').set('Content-Type', 'application/vnd.rhiza.workspace+zip').set('Idempotency-Key', 'restore-backup').send(download.body).expect(201);
    await request(importedApp).post('/api/bundle/import').set('Content-Type', 'application/vnd.rhiza.workspace+zip').set('Idempotency-Key', 'restore-backup').send(download.body).expect(201);
    expect(factsHash(await target.readPortableWorkspace())).toBe(before);
    expect(await inspectM10Store(target)).toMatchObject({ ok: true });
    const restored = await target.read(); expect(restored.messages).toHaveLength((await store.read()).messages.length);
    const version = restored.resourceVersions.find(version => version.id === upload.body.attachment.resourceVersionId)!;
    expect(Buffer.from(await NodeEncryptedBlobStore.atDirectory(join(targetRoot, 'uploads')).read(version.blobRef, version.digest)).toString()).toBe('Durable backup attachment');
    await request(importedApp).post('/api/chat').set('Idempotency-Key', 'continue-restored-backup').send({ message: 'Continue restored discussion' }).expect(201);
    await request(importedApp).post('/api/chat').set('Idempotency-Key', 'continue-restored-backup').send({ message: 'Continue restored discussion' }).expect(201);
    expect((await target.read()).messages.length).toBe(restored.messages.length + 2);
    expect(await inspectM10Store(target)).toMatchObject({ ok: true });
  } finally { await target.close(); await store.close(); await rm(root, { recursive: true, force: true }); }
});

it('a failed backup SQL publication preserves the registered encrypted digest, failure and explicit retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-managed-backup-failure-'));
  const archives = new NodeImportArchiveStore(join(root, 'uploads', 'imports'));
  const store = await openEmbeddedWorkspaceStore(join(root, 'db'), undefined, 'apply', NodeEncryptedBlobStore.atDirectory(join(root, 'uploads')), archives);
  try {
    const app = appFor(store, root); await request(app).get('/api/workspace').expect(200); await store.backfillJournal();
    const database = (store as unknown as { database: SqlQueryable & { exec(sql: string): Promise<unknown>; transaction<T>(work: (transaction: SqlQueryable) => Promise<T>): Promise<T> } }).database;
    const transaction = database.transaction.bind(database); let injected = false;
    const fault = vi.spyOn(database, 'transaction').mockImplementation(work => transaction(async active => {
      const result = await work(active);
      if (!injected && (await active.query("SELECT 1 FROM managed_backups WHERE workspace_id=$1 AND status='ready'", [store.defaultWorkspaceId])).rows.length) {
        injected = true; throw Object.assign(new Error('injected final SQL commit failure'), { code: '53100' });
      }
      return result;
    }));
    const failed = (await request(app).post('/api/backups').set('Idempotency-Key', 'backup-failure').send({}).expect(201)).body; fault.mockRestore();
    expect(injected).toBe(true); expect(failed).toMatchObject({ status: 'failed', errorCode: 'BACKUP_FAILED', archiveDigest: expect.any(String) });
    const retained = await archives.stage(failed.archiveDigest); await retained.dispose();
    await request(app).get(`/api/backups/${encodeURIComponent(failed.backupId)}/archive`).expect(409);
    expect((await request(app).post('/api/backups').set('Idempotency-Key', 'backup-failure').send({}).expect(201)).body).toEqual(failed);
    const retry = (await request(app).post('/api/backups').set('Idempotency-Key', 'backup-explicit-retry').send({ retryOf: failed.backupId }).expect(201)).body;
    expect(retry).toMatchObject({ status: 'ready', retryOf: failed.backupId });
    await request(app).post('/api/backups').send({ retryOf: retry.backupId }).expect(409);
    await expect(database.exec(await readFile(new URL('../db/migrations/0039_managed_backups.down.sql', import.meta.url), 'utf8'))).rejects.toThrow('Managed backup inventory must be preserved');
    expect((await request(app).get('/api/backups').expect(200)).body.backups).toContainEqual(expect.objectContaining({ backupId: retry.backupId, status: 'ready' }));
  } finally { vi.restoreAllMocks(); await store.close(); await rm(root, { recursive: true, force: true }); }
});

it('Purge protects active backup work, revokes ready copies and preserves another Workspace independent archive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-managed-backup-purge-'));
  const archives = new NodeImportArchiveStore(join(root, 'uploads', 'imports'));
  const store = await openEmbeddedWorkspaceStore(join(root, 'db'), undefined, 'apply', NodeEncryptedBlobStore.atDirectory(join(root, 'uploads')), archives);
  let release = () => {}; let pending: Promise<request.Response> | undefined;
  try {
    const app = appFor(store, root); await request(app).get('/api/workspace').expect(200); await store.backfillJournal();
    const created = await request(app).post('/api/graph/nodes').send({ title: 'Private backup node', summary: 'Body to purge' }).expect(201);
    const node = created.body.workspace.discussionNodes.find((node: { title: string }) => node.title === 'Private backup node');
    await request(app).patch(`/api/nodes/${node.id}/status`).send({ status: 'archived' }).expect(200);
    const otherWorkspace = await request(app).post('/api/v1/workspaces').send({ name: 'Independent backup' }).expect(201);
    const otherId = otherWorkspace.body.workspace.workspaceId;
    const other = (await request(app).post(`/api/v1/workspaces/${otherId}/backups`).send({}).expect(201)).body;
    const gate = new Promise<void>(resolve => { release = resolve; }); let exporting = false;
    const original = NodePortableBundle.prototype.export;
    const pause = vi.spyOn(NodePortableBundle.prototype, 'export').mockImplementationOnce(async function (this: NodePortableBundle, ...args) { exporting = true; await gate; return original.apply(this, args); });
    pending = request(app).post('/api/backups').set('Idempotency-Key', 'active-backup').send({}).then(response => response);
    await vi.waitFor(() => expect(exporting).toBe(true), { timeout: 3000 });
    await request(app).post(`/api/graph/nodes/${node.id}/purge`).send({ confirmation: `PURGE ${node.id}`, reason: 'Scoped backup purge fixture' }).expect(409);
    release(); const ready = await pending; expect(ready.status).toBe(201); expect(ready.body.status).toBe('ready'); pause.mockRestore();
    const digest = ready.body.archiveDigest;
    await request(app).post(`/api/graph/nodes/${node.id}/purge`).send({ confirmation: `PURGE ${node.id}`, reason: 'Scoped backup purge fixture' }).expect(200);
    expect((await request(app).get('/api/backups').expect(200)).body.backups).toContainEqual(expect.objectContaining({ backupId: ready.body.backupId, status: 'purged' }));
    await expect(archives.stage(digest)).rejects.toThrow();
    await request(app).get(`/api/backups/${encodeURIComponent(ready.body.backupId)}/archive`).expect(409);
    const unrelated = await archives.stage(other.archiveDigest); await unrelated.dispose();
    await request(app).get(`/api/v1/workspaces/${otherId}/backups/${encodeURIComponent(other.backupId)}/archive`).buffer(true).parse(archiveBuffer).expect(200);
    expect(await store.auditPurgeCompletion()).toMatchObject({ pending: 0, unrevokedReferences: 0 });
  } finally { release(); await pending?.catch(() => undefined); vi.restoreAllMocks(); await store.close(); await rm(root, { recursive: true, force: true }); }
});
