// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { expect, it } from 'vitest';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { createApp } from '../server/app';
import { ProviderService } from '../server/provider-service';
import { ProviderStore } from '../server/provider-store';
import { SecretVault } from '../server/secret-vault';
import type { AIRuntime, RuntimeRequest } from '../server/ai-runtime';
import { NodeEncryptedBlobStore } from '../server/infrastructure/node-encrypted-blob-store';
import { NodeImportArchiveStore } from '../server/infrastructure/portable-content';
import { portableWorkspaceFacts } from '../server/application/portable-workspace';
import { validatePortableReferences } from '../server/application/portable-references';
import { semanticStateChecksum } from '../server/infrastructure/workspace-semantic-checksum';

it('M16 commits collaboration facts before dispatch, freezes round/retry inputs and keeps ordinary Chat independent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m16-collaboration-'));
  const blobs = NodeEncryptedBlobStore.atDirectory(join(root, 'uploads'));
  const store = await openEmbeddedWorkspaceStore(join(root, 'db'), undefined, 'apply', blobs, new NodeImportArchiveStore(join(root, 'uploads','imports')));
  try {
    const provider = new ProviderService(new ProviderStore(join(root, 'providers')), new SecretVault(join(root, 'key')), { baseUrl: 'https://example.test', apiKey: '', model: 'a', providerName: 'Fixture', chatPath: '/chat', timeoutMs: 1000, temperature: 0, extraHeaders: {}, allowNoKey: true });
    const calls: RuntimeRequest[] = []; let failB = true;
    const runtime: AIRuntime = { kind: 'provider-adapter', listModels: async () => ['a','b'].map(id => ({ id, model: id, provider: 'Fixture', displayName: id, active: id === 'a', providerEndpointRef: `fixture-${id}` })),
      async *generate(input) {
        expect((await store.getRun!(input.requestId))?.status).toBe('running');
        calls.push(input);
        if (input.modelId === 'b' && failB) { yield { type: 'RUN_ERROR', requestId: input.requestId, code: 'PROVIDER_TIMEOUT', message: 'fixture', status: 504 }; return; }
        const record = input.prompt.startsWith('Synthesize collaboration') ? (await store.listCollaborations!()).find(record => record.attempts.some(attempt => attempt.runRef === input.requestId)) : undefined;
        const text = record ? JSON.stringify({ recommendation: 'Use A', rationale: 'Verified offline', alternatives: [{ option: 'B', pros: ['Fast'], cons: ['Network'], applicability: 'Online' }], risks: ['Missing B'], disagreements: [], sourceOutputRefs: record.attempts.filter(attempt => attempt.status === 'completed').flatMap(attempt => attempt.outputRef ? [attempt.outputRef] : []) }) : `Answer ${input.modelId}`;
        yield { type: 'RUN_END', requestId: input.requestId, text, model: input.modelId, provider: 'Fixture', usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 } };
      },
    };
    const app = createApp(store, provider, false, runtime, undefined, join(root, 'uploads'));
    await request(app).get('/api/workspace').expect(200);
    const original = await store.read();
    await store.backfillJournal();
    const created = await request(app).post('/api/collaborations').set('Idempotency-Key', 'create-collaboration').send({ prompt: 'Compare options', mode: 'debate', modelIds: ['a','b'], synthesisModelId: 'a' }).expect(201);
    const record = created.body.collaboration;
    expect(record.base.nodeId).toBe(original.activeNodeId);
    expect((await store.read()).activeNodeId).toBe(original.activeNodeId);
    expect(calls).toHaveLength(0);
    const invokeA = { participantId: 'a', round: 1 };
    const first = await request(app).post(`/api/collaborations/${record.id}/invoke`).set('Idempotency-Key', 'invoke-a').send(invokeA).expect(201);
    await request(app).post(`/api/collaborations/${record.id}/invoke`).set('Idempotency-Key', 'invoke-a').send(invokeA).expect(201);
    expect(calls).toHaveLength(1);
    expect(first.body.collaboration.attempts[0]).toMatchObject({ status: 'completed', runRef: calls[0].requestId, manifestRef: first.body.result.manifest.id, outputRef: first.body.result.assistantMessage.id });
    await request(app).post(`/api/collaborations/${record.id}/invoke`).send({ participantId: 'b', round: 1 }).expect(504);
    const failed = (await request(app).get(`/api/collaborations/${record.id}`).expect(200)).body.collaboration;
    expect(failed.attempts[1].status).toBe('failed');
    expect(failed.attempts[0].input.base).toEqual(failed.attempts[1].input.base);
    expect(failed.attempts[1].input.exchange).toEqual([]);
    failB = false;
    await request(app).post(`/api/collaborations/${record.id}/retry`).send({ attemptId: failed.attempts[1].id }).expect(201);
    const retried = (await store.getCollaboration!(record.id))!;
    expect(retried.attempts.at(-1)?.input).toEqual(failed.attempts[1].input);
    expect(calls.filter(call => call.modelId === 'a')).toHaveLength(1);
    await request(app).post(`/api/collaborations/${record.id}/invoke`).send({ participantId: 'a', round: 2 }).expect(201);
    expect(calls.at(-1)?.prompt).toContain('Answer b');
    await request(app).post('/api/chat').send({ message: 'ordinary' }).expect(201);
    expect(calls.at(-1)?.history.some(message => message.text.startsWith('Answer '))).toBe(false);
    await request(app).post(`/api/collaborations/${record.id}/stop`).send({}).expect(200);
    const stopped = (await store.getCollaboration!(record.id))!;
    const count = calls.length;
    await request(app).post(`/api/collaborations/${record.id}/invoke`).send({ participantId: 'b', round: 2 }).expect(409);
    expect(calls).toHaveLength(count); expect(stopped.status).toBe('canceled');
    await request(app).get(`/api/v1/workspaces/10000000-0000-4000-8000-000000000099/collaborations/${record.id}`).expect(403);
    await store.reconcileRuns();
    expect((await store.getCollaboration!(record.id))?.status).toBe('canceled');

    const second = (await request(app).post('/api/collaborations').send({ prompt: 'Summarize fixture', mode: 'independent-review', modelIds: ['a','b'], synthesisModelId: 'a' }).expect(201)).body.collaboration;
    await request(app).post(`/api/collaborations/${second.id}/invoke`).send({ participantId: 'a', round: 1 }).expect(201);
    failB = true;
    await request(app).post(`/api/collaborations/${second.id}/invoke`).send({ participantId: 'b', round: 1 }).expect(504);
    const synthesis = await request(app).post(`/api/collaborations/${second.id}/synthesize`).set('Idempotency-Key','synthesize').send({}).expect(201);
    expect(synthesis.body.collaboration.status).toBe('partial');
    expect(synthesis.body.collaboration.synthesis.missingParticipants).toMatchObject([{ participantId: 'b', status: 'failed' }]);
    const retained = await request(app).post(`/api/collaborations/${second.id}/retain`).set('Idempotency-Key','retain').send({ targetNodeId: original.activeNodeId }).expect(201);
    expect(retained.body.message.sourceMessageId).toBe(synthesis.body.result.assistantMessage.id);
    expect(retained.body.message.nodeId).toBe(original.activeNodeId);
    expect((await request(app).post(`/api/collaborations/${second.id}/retain`).set('Idempotency-Key','retain').send({ targetNodeId: original.activeNodeId }).expect(201)).body).toEqual(retained.body);
    expect((await store.read()).messages.find(message => message.id === synthesis.body.result.assistantMessage.id)?.text).toBe(synthesis.body.result.assistantMessage.text);

    const portable = portableWorkspaceFacts(await store.readPortableWorkspace!(), input => semanticStateChecksum(input as Record<string, unknown>));
    try { validatePortableReferences(portable); } catch (error) { throw new Error(`Invalid fixture references: ${JSON.stringify((error as { missingRefs?: string[] }).missingRefs)}`, { cause: error }); }
    const download = await request(app).get(`/api/v1/workspaces/${original.projectId}/bundle`).buffer(true).parse((response, callback) => {
      const chunks: Buffer[] = []; response.on('data', (chunk: Buffer) => chunks.push(chunk)); response.on('end', () => callback(null, Buffer.concat(chunks))); response.on('error', callback);
    });
    expect(download.status, download.body.toString()).toBe(200);
    const importedBlobs = NodeEncryptedBlobStore.atDirectory(join(root,'imported-uploads'));
    const importedStore = await openEmbeddedWorkspaceStore(join(root,'imported-db'), undefined, 'apply', importedBlobs, new NodeImportArchiveStore(join(root,'imported-uploads','imports')));
    try {
      const importedApp = createApp(importedStore, provider, false, runtime, undefined, join(root,'imported-uploads'), importedBlobs);
      await request(importedApp).post('/api/bundle/preview').set('Content-Type','application/vnd.rhiza.workspace+zip').send(download.body).expect(200);
      await request(importedApp).post('/api/bundle/import').set('Content-Type','application/vnd.rhiza.workspace+zip').set('Idempotency-Key','roundtrip').send(download.body).expect(201);
      expect((await importedStore.getCollaboration!(second.id))?.synthesis).toEqual(synthesis.body.collaboration.synthesis);
      expect((await importedStore.getCollaboration!(record.id))?.base.contextBaseHash).toBe(record.base.contextBaseHash);
    } finally { await importedStore.close(); }

    await request(app).patch(`/api/nodes/${record.nodeId}/status`).send({ status: 'archived' }).expect(200);
    await request(app).post(`/api/graph/nodes/${record.nodeId}/purge`).send({ confirmation: `PURGE ${record.nodeId}`, reason: 'fixture cleanup' }).expect(200);
    await request(app).get(`/api/collaborations/${record.id}`).expect(404);
    expect((await store.getCollaboration!(second.id))?.synthesis).toEqual(synthesis.body.collaboration.synthesis);
    expect(await store.auditPurgeCompletion()).toMatchObject({ pending: 0, unrevokedReferences: 0 });
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});
