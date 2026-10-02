// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { ProviderService } from '../server/provider-service';
import { ProviderStore } from '../server/provider-store';
import { SecretVault } from '../server/secret-vault';
import { NodeEncryptedBlobStore } from '../server/infrastructure/node-encrypted-blob-store';
import { LOCAL_USER_ID } from '../server/identity/workspace-scope';
import { createSeedWorkspace } from '../server/seed';
import type { SqlQueryable } from '../server/postgres-store';

const binaryResponse = (response: request.Response, done: (error: Error | null, value?: Buffer) => void) => {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => done(null, Buffer.concat(chunks))); response.on('error', done);
};

it('serves exact scoped resource previews and verified downloads without mutations, and refuses corrupt, missing and Purged versions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-resource-version-'));
  const uploads = join(root, 'uploads'), blobs = NodeEncryptedBlobStore.atDirectory(uploads);
  const store = await openEmbeddedWorkspaceStore(join(root, 'db'), undefined, 'apply', blobs);
  let modelCalls = 0;
  try {
    const provider = new ProviderService(new ProviderStore(join(root, 'providers')), new SecretVault(join(root, 'key')), {
      baseUrl: 'https://example.test', apiKey: '', model: 'fixture', providerName: 'Fixture', chatPath: '/chat', timeoutMs: 1000, temperature: 0, extraHeaders: {}, allowNoKey: true,
    });
    const app = createApp(store, provider, false, { kind: 'provider-adapter', listModels: async () => [], async *generate(input) {
      modelCalls++; yield { type: 'RUN_END', requestId: input.requestId, text: 'unexpected model dispatch', model: 'fixture', provider: 'Fixture' };
    } }, undefined, uploads, blobs);
    const database = (store as unknown as { database: SqlQueryable }).database;
    const freshCounts = (await database.query('SELECT (SELECT count(*) FROM workspace_events) events,(SELECT count(*) FROM rhiza_projects) projects')).rows;
    await request(app).get('/api/resources/unavailable/versions/unavailable').expect(403);
    expect((await database.query('SELECT (SELECT count(*) FROM workspace_events) events,(SELECT count(*) FROM rhiza_projects) projects')).rows).toEqual(freshCounts);
    await request(app).get('/api/workspace').expect(200);
    const workspaceId = store.defaultWorkspaceId;
    const otherWorkspaceId = randomUUID();
    await store.workspaceDirectory.ensureWorkspace({ workspaceId: otherWorkspaceId, name: 'Other scope', status: 'active', createdBy: LOCAL_USER_ID, revision: 1 });
    await store.forWorkspace(otherWorkspaceId).initialize!({ ...createSeedWorkspace(), projectId: otherWorkspaceId });
    const resourceId = 'resource-exact', createdAt = new Date().toISOString();
    await database.query('INSERT INTO rhiza_resources(resource_id,workspace_id,kind,logical_name,created_at) VALUES($1,$2,$3,$4,$5)', [resourceId, workspaceId, 'context-source', '../untrusted.html', createdAt]);
    const publish = async (versionId: string, ordinal: number, bytes: Buffer, mediaType: string) => {
      const blob = await blobs.put(bytes, { workspaceId, contentId: versionId });
      await database.query(`INSERT INTO rhiza_resource_versions(resource_version_id,resource_id,version,digest_algorithm,digest,canonicalization,media_type,size_bytes,blob_ref,created_at)
        VALUES($1,$2,$3,'sha256',$4,'raw-v1',$5,$6,$7,$8)`, [versionId, resourceId, ordinal, blob.digest, mediaType, blob.size, blob.blobRef, createdAt]);
      return blob;
    };
    const oldBytes = Buffer.from(JSON.stringify({ schemaVersion: '1.0.0', content: 'Frozen original\n正文' }));
    const old = await publish('old-version', 1, oldBytes, 'application/vnd.rhiza.context+json');
    await publish('new-version', 2, Buffer.from('New revision'), 'text/plain');
    await publish('binary-version', 3, Buffer.from([0, 255, 1]), 'image/png');
    await publish('large-version', 4, Buffer.from('x'.repeat(256 * 1024 + 1)), 'text/plain');
    const missing = await publish('missing-version', 5, Buffer.from('missing'), 'text/plain');
    const path = (id: string, scope = workspaceId) => `/api/v1/workspaces/${scope}/resources/${resourceId}/versions/${id}`;
    const counts = async () => (await database.query(`SELECT
      (SELECT count(*)::int FROM command_receipts) receipts,
      (SELECT count(*)::int FROM workspace_events) events,
      (SELECT count(*)::int FROM execution_runs) runs,
      (SELECT count(*)::int FROM rhiza_resource_versions) versions`)).rows;
    const before = await counts();
    const preview = (await request(app).get(path('old-version')).expect(200)).body;
    expect(preview).toEqual({ resource: { id: resourceId, workspaceId, kind: 'context-source', title: '../untrusted.html' },
      version: { id: 'old-version', resourceId, version: 1, digestAlgorithm: 'sha256', digest: old.digest, canonicalization: 'raw-v1', mediaType: 'application/vnd.rhiza.context+json', size: oldBytes.length, createdAt },
      preview: { kind: 'text', text: 'Frozen original\n正文' } });
    expect(JSON.stringify(preview)).not.toMatch(/blobRef|sealed-v1|resource-keys|content_ref/);
    expect((await request(app).get(path('new-version')).expect(200)).body.preview).toEqual({ kind: 'text', text: 'New revision' });
    expect((await request(app).get(path('binary-version')).expect(200)).body.preview).toEqual({ kind: 'binary' });
    expect((await request(app).get(path('large-version')).expect(200)).body.preview).toEqual({ kind: 'too_large' });
    const download = await request(app).get(`${path('old-version')}/content`).buffer(true).parse(binaryResponse).expect(200);
    expect(download.body).toEqual(oldBytes);
    expect(download.headers).toMatchObject({ 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-disposition': 'attachment; filename="resource-version.bin"' });
    await request(app).get(path('old-version', otherWorkspaceId)).expect(404);
    await request(app).get(path('old-version', randomUUID())).expect(403);
    await request(app).get(path('unavailable')).expect(404);
    await request(app).get(path('old-version').replace(resourceId, 'wrong-resource')).expect(404);
    await store.workspaceDirectory.updateWorkspace({ workspaceId, name: 'Archived reads', status: 'archived', createdBy: LOCAL_USER_ID, revision: 2 }, 1);
    await request(app).get(path('old-version')).expect(200);
    const cipherPath = (reference: string) => { const digest = reference.split('/')[3]; return join(uploads, 'blobs', 'sha256', digest.slice(0, 2), digest); };
    await rm(cipherPath(missing.blobRef));
    expect((await request(app).get(path('missing-version')).expect(404)).body.error.code).toBe('RESOURCE_CONTENT_MISSING');
    const ciphertext = await readFile(cipherPath(old.blobRef)); ciphertext[35] ^= 1;
    await writeFile(cipherPath(old.blobRef), ciphertext);
    expect((await request(app).get(`${path('old-version')}/content`).expect(409)).body.error.code).toBe('RESOURCE_CONTENT_INVALID');
    const purgeId = randomUUID();
    await database.query('INSERT INTO purge_checkpoints(purge_id,workspace_id,node_id) VALUES($1,$2,$3)', [purgeId, workspaceId, randomUUID()]);
    await database.query("INSERT INTO purge_key_references(purge_id,ordinal,content_family,entity_id,content_ref) VALUES($1,0,'resource-version','new-version','{}'::jsonb)", [purgeId]);
    expect((await request(app).get(path('new-version')).expect(410)).body.error.code).toBe('RESOURCE_VERSION_PURGED');
    await request(app).get(`${path('new-version')}/content`).expect(410);
    expect(await counts()).toEqual(before); expect(modelCalls).toBe(0);
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
}, 30_000);
