// @vitest-environment node
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { expect, it, vi } from 'vitest';
import { createApp } from '../server/app';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { ProviderService } from '../server/provider-service';
import { ProviderStore } from '../server/provider-store';
import { SecretVault } from '../server/secret-vault';
import { NodeEncryptedBlobStore } from '../server/infrastructure/node-encrypted-blob-store';
import { NodeImportArchiveStore } from '../server/infrastructure/portable-content';
import type { SqlQueryable } from '../server/postgres-store';
import { RepositoryWorkspaceUnitOfWork } from '../server/infrastructure/workspace-repository-unit-of-work';
import { completeBundleImport } from '../server/application/prepare-bundle-import';
import { ingestPortableWorkspace } from '../server/infrastructure/portable-content';
import { semanticStateChecksum } from '../server/infrastructure/workspace-semantic-checksum';
import { LOCAL_USER_ID } from '../server/identity/workspace-scope';
import type { BundleImportCheckpoint } from '../server/application/ports/bundle-import';
import { portableWorkspaceFacts } from '../server/application/portable-workspace';
import type { PortableWorkspaceFacts } from '../server/application/ports/portable-workspace';

const mediaType = 'application/vnd.rhiza.workspace+zip';
const portableChecksum = (facts: PortableWorkspaceFacts) => semanticStateChecksum({ facts: portableWorkspaceFacts(facts,
  value => semanticStateChecksum(value as Record<string, unknown>)) });
function appFor(store: Awaited<ReturnType<typeof openEmbeddedWorkspaceStore>>, root: string, onCall: () => never) {
  const provider = new ProviderService(new ProviderStore(join(root, 'providers')), new SecretVault(join(root, 'key')), { baseUrl: 'https://example.test', apiKey: '', model: 'fixture', providerName: 'Fixture', chatPath: '/chat', timeoutMs: 1000, temperature: 0, extraHeaders: {}, allowNoKey: true });
  return createApp(store, provider, false, { kind: 'provider-adapter', listModels: async () => [], generate: onCall }, undefined, join(root, 'uploads'));
}
const archiveBuffer = (response: request.Response, callback: (error: Error | null, value?: Buffer) => void) => {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk)); response.on('end', () => callback(null, Buffer.concat(chunks))); response.on('error', callback);
};

it('previews omitted exact versions without writing checkpoints or keys, refuses incomplete import before mutation, and preserves default full import', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-external-http-'));
  const sourceRoot = join(root, 'source'), targetRoot = join(root, 'target');
  const source = await openEmbeddedWorkspaceStore(join(sourceRoot, 'db'), undefined, 'apply', NodeEncryptedBlobStore.atDirectory(join(sourceRoot, 'uploads')), new NodeImportArchiveStore(join(sourceRoot, 'uploads', 'imports')));
  const target = await openEmbeddedWorkspaceStore(join(targetRoot, 'db'), undefined, 'apply', NodeEncryptedBlobStore.atDirectory(join(targetRoot, 'uploads')), new NodeImportArchiveStore(join(targetRoot, 'uploads', 'imports')));
  let modelCalls = 0; const noCall = (): never => { modelCalls++; throw new Error('Preview/import must not call a model'); };
  try {
    const sourceApp = appFor(source, sourceRoot, noCall), targetApp = appFor(target, targetRoot, noCall);
    const created = await request(sourceApp).post('/api/v1/workspaces').send({ name: 'External resources fixture' }).expect(201);
    const workspaceId = created.body.workspace.workspaceId; expect(workspaceId).toEqual(expect.any(String)); const base = `/api/v1/workspaces/${workspaceId}`;
    await request(sourceApp).post(`${base}/attachments`).send({ name: 'notes.txt', mimeType: 'text/plain', dataBase64: Buffer.from('The frozen attachment').toString('base64') }).expect(201);
    const thin = await request(sourceApp).get(`${base}/bundle?includeResources=false`).buffer(true).parse(archiveBuffer).expect(200);
    await request(sourceApp).get(`${base}/bundle?includeResources=maybe`).expect(400);
    const database = (target as unknown as { database: SqlQueryable }).database;
    const counts = async () => (await database.query('SELECT (SELECT count(*)::integer FROM bundle_imports) imports,(SELECT count(*)::integer FROM command_receipts) receipts,(SELECT count(*)::integer FROM workspaces) workspaces')).rows;
    const before = await counts();
    const preview = await request(targetApp).post('/api/bundle/preview').set('Content-Type', mediaType).send(thin.body).expect(200);
    expect(preview.body).toMatchObject({ workspaceId, canImport: false, documentVersion: '3.0.0', missingResourceCount: 1, missingResourcesTruncated: false,
      missingResources: [expect.objectContaining({ resourceVersionId: expect.any(String), digest: expect.stringMatching(/^[a-f0-9]{64}$/), size: 21 })] });
    const rejected = await request(targetApp).post('/api/bundle/import').set('Content-Type', mediaType).set('Idempotency-Key', 'external-missing').send(thin.body).expect(400);
    expect(rejected.body.error.code).toBe('BUNDLE_EXTERNAL_CONTENT_REQUIRED');
    expect(await counts()).toEqual(before);
    expect(await readdir(join(targetRoot, 'uploads', 'imports', 'transient'))).toEqual([]);
    expect(await readdir(join(targetRoot, 'uploads', 'imports', 'retained')).catch(() => [])).toEqual([]);
    const full = await request(sourceApp).get(`${base}/bundle`).buffer(true).parse(archiveBuffer).expect(200);
    expect((await request(targetApp).post('/api/bundle/preview').set('Content-Type', mediaType).send(full.body).expect(200)).body).toMatchObject({ canImport: true, missingResourceCount: 0 });
    await request(targetApp).post('/api/bundle/import').set('Content-Type', mediaType).set('Idempotency-Key', 'full-import').send(full.body).expect(201);
    await request(targetApp).post('/api/bundle/import').set('Content-Type', mediaType).set('Idempotency-Key', 'full-import').send(full.body).expect(201);
    expect(modelCalls).toBe(0);
  } finally { await source.close(); await target.close(); await rm(root, { recursive: true, force: true }); }
});

it('hydrates exact HTTP uploads into a complete archive and resumes its retained ciphertext after activation interruption', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-hydrated-recovery-'));
  const sourceRoot = join(root, 'source'), targetRoot = join(root, 'target');
  const source = await openEmbeddedWorkspaceStore(join(sourceRoot, 'db'), undefined, 'apply', NodeEncryptedBlobStore.atDirectory(join(sourceRoot, 'uploads')), new NodeImportArchiveStore(join(sourceRoot, 'uploads', 'imports')));
  let target = await openEmbeddedWorkspaceStore(join(targetRoot, 'db'), undefined, 'apply', NodeEncryptedBlobStore.atDirectory(join(targetRoot, 'uploads')), new NodeImportArchiveStore(join(targetRoot, 'uploads', 'imports')));
  let modelCalls = 0; const noCall = (): never => { modelCalls++; throw new Error('Hydration/restore must not call a model'); };
  try {
    const sourceApp = appFor(source, sourceRoot, noCall), targetApp = appFor(target, targetRoot, noCall);
    const workspaceId = (await request(sourceApp).post('/api/v1/workspaces').send({ name: 'Hydrated recovery' }).expect(201)).body.workspace.workspaceId as string;
    const attachmentBytes = Buffer.from('Frozen attachment bytes');
    await request(sourceApp).post(`/api/v1/workspaces/${workspaceId}/attachments`).send({ name: 'notes.txt', mimeType: 'text/plain', dataBase64: attachmentBytes.toString('base64') }).expect(201);
    const original = await source.forWorkspace(workspaceId).readPortableWorkspace!();
    const originalDigest = portableChecksum(original);
    const thin = (await request(sourceApp).get(`/api/v1/workspaces/${workspaceId}/bundle?includeResources=false`).buffer(true).parse(archiveBuffer).expect(200)).body as Buffer;
    const missing = (await request(targetApp).post('/api/bundle/preview').set('Content-Type', mediaType).send(thin).expect(200)).body.missingResources[0];
    const hydrate = (bytes: Buffer, id = missing.resourceVersionId) => request(targetApp).post('/api/bundle/hydrate')
      .attach(`resource:${id}`, bytes, { filename: '../../supplied.txt' }).attach('bundle', thin, { filename: '/source.rhiza' });
    expect((await hydrate(Buffer.alloc(attachmentBytes.length, 120)).expect(400)).body.error.code).toBe('BUNDLE_EXTERNAL_CONTENT_MISMATCH');
    expect((await hydrate(attachmentBytes, 'unknown-version').expect(400)).body.error.code).toBe('BUNDLE_EXTERNAL_DESCRIPTOR_MISMATCH');
    await request(targetApp).post('/api/bundle/hydrate').set('Content-Type', mediaType).send(thin).expect(415);
    await request(targetApp).post('/api/bundle/hydrate').attach('bundle', thin).expect(400);
    const database = () => (target as unknown as { database: SqlQueryable }).database;
    expect((await database().query('SELECT count(*)::integer AS count FROM bundle_imports')).rows[0].count).toBe(0);
    expect(await target.listWorkspaceIds()).toEqual([]);
    const complete = (await hydrate(attachmentBytes).buffer(true).parse(archiveBuffer).expect(200)).body as Buffer;
    expect((await request(targetApp).post('/api/bundle/preview').set('Content-Type', mediaType).send(complete).expect(200)).body).toMatchObject({ canImport: true, missingResourceCount: 0, workspaceId });
    expect(await readdir(join(targetRoot, 'uploads', 'imports', 'transient'))).toEqual([]);
    const activation = vi.spyOn(RepositoryWorkspaceUnitOfWork.prototype, 'activatePortableImport').mockRejectedValueOnce(new Error('fixture activation interruption'));
    try { await request(targetApp).post('/api/bundle/import').set('Idempotency-Key', 'hydrated-recovery').set('Content-Type', mediaType).send(complete).expect(500); }
    finally { activation.mockRestore(); }
    const checkpoint = (await database().query<BundleImportCheckpoint>('SELECT import_id AS "importId",owner_id AS "ownerId",workspace_id AS "workspaceId",archive_digest AS "archiveDigest",state_digest AS "stateDigest",phase,revision FROM bundle_imports')).rows[0];
    expect(checkpoint.phase).toBe('blobs-ready'); expect(await target.listWorkspaceIds()).toEqual([]);
    expect(await readdir(join(targetRoot, 'uploads', 'imports', 'transient'))).toEqual([]);
    await target.close();
    const blobs = NodeEncryptedBlobStore.atDirectory(join(targetRoot, 'uploads'));
    const archives = new NodeImportArchiveStore(join(targetRoot, 'uploads', 'imports'));
    target = await openEmbeddedWorkspaceStore(join(targetRoot, 'db'), undefined, 'verify', blobs, archives);
    const recovered = await archives.stage(checkpoint.archiveDigest);
    expect(semanticStateChecksum({ facts: recovered.facts })).toBe(checkpoint.stateDigest);
    try { await completeBundleImport(checkpoint, recovered.facts, target.bundleImportCheckpoints, () => ingestPortableWorkspace(recovered, blobs), new RepositoryWorkspaceUnitOfWork(target)); }
    finally { await recovered.dispose(); }
    let duplicateIngestions = 0;
    await completeBundleImport(checkpoint, original, target.bundleImportCheckpoints, async () => { duplicateIngestions++; throw new Error('duplicate ingest'); }, new RepositoryWorkspaceUnitOfWork(target));
    expect((await target.bundleImportCheckpoints.read(checkpoint.importId, LOCAL_USER_ID))?.phase).toBe('activated');
    const restored = await target.forWorkspace(workspaceId).readPortableWorkspace!();
    expect(portableChecksum(restored)).toBe(originalDigest);
    const version = restored.workspace.resourceVersions.find(item => item.id === missing.resourceVersionId)!;
    expect(Buffer.from(await blobs.read(version.blobRef, version.digest))).toEqual(attachmentBytes);
    expect(portableChecksum(await source.forWorkspace(workspaceId).readPortableWorkspace!())).toBe(originalDigest);
    expect(duplicateIngestions).toBe(0); expect(modelCalls).toBe(0);
  } finally { await source.close(); await target.close(); await rm(root, { recursive: true, force: true }); }
});
