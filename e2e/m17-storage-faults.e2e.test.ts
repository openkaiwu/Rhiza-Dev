// @vitest-environment node
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { NodeEncryptedBlobStore } from '../server/infrastructure/node-encrypted-blob-store';
import { NodeFilesystemBlobStore } from '../server/infrastructure/node-host-runtime';
import { NodeContentKeys } from '../server/infrastructure/node-content-keys';
import { NodeSealedContentStore } from '../server/infrastructure/node-sealed-content-store';
import { ProviderService } from '../server/provider-service';
import { ProviderStore } from '../server/provider-store';
import { SecretVault } from '../server/secret-vault';
import { semanticChecksum } from '../server/infrastructure/workspace-semantic-checksum';
import type { SqlQueryable } from '../server/postgres-store';

it.each(['upload', 'context'] as const)('M17 %s ENOSPC before Blob publication leaves no half-commit or model dispatch and permits a manual idempotent retry', async surface => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m17-enospc-'));
  const uploads = join(root, 'uploads');
  let faultEnabled = false, failedPublications = 0, modelCalls = 0;
  const rawBlobs = new NodeFilesystemBlobStore(uploads, checkpoint => {
    if (faultEnabled && checkpoint === 'temp-written') {
      failedPublications++;
      throw Object.assign(new Error('Injected storage capacity failure'), { code: 'ENOSPC', syscall: 'write' });
    }
  });
  const keys = new NodeContentKeys(join(uploads, 'resource-keys'));
  const blobs = new NodeEncryptedBlobStore(new NodeSealedContentStore(rawBlobs, keys), rawBlobs, uploads);
  const store = await openEmbeddedWorkspaceStore(join(root, 'db'), undefined, 'apply', blobs);
  try {
    const provider = new ProviderService(new ProviderStore(join(root, 'providers')), new SecretVault(join(root, 'key')), {
      baseUrl: 'https://example.test', apiKey: '', model: 'fixture', providerName: 'Fixture', chatPath: '/chat', timeoutMs: 1000,
      temperature: 0, extraHeaders: {}, allowNoKey: true,
    });
    const app = createApp(store, provider, false, {
      kind: 'provider-adapter', listModels: async () => [{ id: 'fixture', model: 'fixture', provider: 'Fixture', displayName: 'Fixture', active: true, providerEndpointRef: 'fixture-endpoint' }],
      async *generate(input) {
        modelCalls++;
        yield { type: 'RUN_END', requestId: input.requestId, text: 'Recovered exactly once', model: 'fixture', provider: 'Fixture' };
      },
    }, undefined, uploads, blobs);
    await request(app).get('/api/workspace').expect(200);
    await store.backfillJournal();
    const initial = await store.read();
    const database = (store as unknown as { database: SqlQueryable }).database;
    const counts = async () => (await database.query(`SELECT
      (SELECT count(*)::int FROM command_receipts) receipts,
      (SELECT count(*)::int FROM workspace_events) events,
      (SELECT count(*)::int FROM execution_runs) runs,
      (SELECT count(*)::int FROM rhiza_resource_versions) versions,
      (SELECT count(*)::int FROM rhiza_resources) resources,
      (SELECT count(*)::int FROM rhiza_attachments) attachments,
      (SELECT count(*)::int FROM rhiza_context_manifests) manifests,
      (SELECT count(*)::int FROM rhiza_messages) messages`)).rows;
    const before = await counts();
    const checksum = semanticChecksum(initial);
    const send = () => surface === 'upload'
      ? request(app).post('/api/attachments').set('Idempotency-Key', 'storage-fault-upload').send({ name: 'capacity.txt', mimeType: 'text/plain', dataBase64: Buffer.from('Exact uploaded bytes').toString('base64') })
      : request(app).post('/api/chat').set('Idempotency-Key', 'storage-fault-context').send({ message: 'Continue after storage capacity recovers' });
    faultEnabled = true;
    const failed = await send().expect(500);
    expect(failed.body.error.code).toBe('INTERNAL_ERROR');
    expect(failedPublications).toBeGreaterThan(0);
    expect(modelCalls).toBe(0);
    expect(await counts()).toEqual(before);
    expect(semanticChecksum(await store.read())).toBe(checksum);
    expect(await keys.audit([])).toEqual([]);
    expect(await readdir(join(uploads, 'tmp'))).toEqual([]);

    faultEnabled = false;
    // Recovery requires the caller's explicit new request; the server does no automatic work.
    const retried = await send().expect(201);
    const committed = await counts();
    const settled = await store.read();
    if (surface === 'upload') {
      expect(settled.attachments).toHaveLength(initial.attachments.length + 1);
      const version = settled.resourceVersions.find(item => item.id === retried.body.attachment.resourceVersionId)!;
      expect(Buffer.from(await blobs.read(version.blobRef, version.digest)).toString()).toBe('Exact uploaded bytes');
      expect(modelCalls).toBe(0);
    } else {
      expect(settled.messages).toHaveLength(initial.messages.length + 2);
      expect(settled.manifests).toHaveLength(initial.manifests.length + 1);
      expect(settled.resourceVersions.length).toBeGreaterThan(initial.resourceVersions.length);
      expect(modelCalls).toBe(1);
      expect((await store.listRuns()).map(run => run.status)).toEqual(['completed']);
    }
    const replayed = await send().expect(201);
    expect(replayed.body).toEqual(retried.body);
    expect(await counts()).toEqual(committed);
    expect(semanticChecksum(await store.read())).toBe(semanticChecksum(settled));
    expect(modelCalls).toBe(surface === 'context' ? 1 : 0);
  } finally { faultEnabled = false; await store.close(); await rm(root, { recursive: true, force: true }); }
}, 30_000);
