// @vitest-environment node
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createApp } from '../server/app';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { ProviderService } from '../server/provider-service';
import { ProviderStore } from '../server/provider-store';
import { SecretVault } from '../server/secret-vault';
import { NodeEncryptedBlobStore } from '../server/infrastructure/node-encrypted-blob-store';
import { NodeImportArchiveStore } from '../server/infrastructure/portable-content';
import type { SqlQueryable } from '../server/postgres-store';

const mediaType = 'application/vnd.rhiza.workspace+zip';
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
