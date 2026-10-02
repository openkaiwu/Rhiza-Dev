// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { expect, it, vi } from 'vitest';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { createApp } from '../server/app';
import { ProviderService } from '../server/provider-service';
import { ProviderStore } from '../server/provider-store';
import { SecretVault } from '../server/secret-vault';
import type { AIRuntime, RuntimeRequest } from '../server/ai-runtime';

it('M16 streams bounded modes, exchanges only previous rounds and preserves partial failure without repeated calls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m16-stream-'));
  const store = await openEmbeddedWorkspaceStore(join(root,'db'));
  try {
    const provider = new ProviderService(new ProviderStore(join(root,'providers')), new SecretVault(join(root,'key')), { baseUrl: 'https://example.test', apiKey: '', model: 'a', providerName: 'Fixture', chatPath: '/chat', timeoutMs: 1000, temperature: 0, extraHeaders: {}, allowNoKey: true });
    const calls: RuntimeRequest[] = [];
    const runtime: AIRuntime = { kind: 'provider-adapter', listModels: async () => ['a','b'].map(id => ({ id, model: id, provider: 'Fixture', displayName: id, active: id === 'a' })),
      async *generate(input) {
        calls.push(input);
        const record = (await store.listCollaborations!()).find(record => record.attempts.some(attempt => attempt.runRef === input.requestId))!;
        const attempt = record.attempts.find(attempt => attempt.runRef === input.requestId)!;
        if (attempt.participantId === 'b') { yield { type: 'RUN_ERROR', requestId: input.requestId, code: 'PROVIDER_TIMEOUT', message: 'fixture', status: 504 }; return; }
        yield { type: 'CONTENT_DELTA', requestId: input.requestId, delta: 'fixture' };
        const text = attempt.participantId === '@synthesis' ? JSON.stringify({ recommendation: 'Use A', rationale: 'Fixture', alternatives: [], risks: ['B missing'], disagreements: [], sourceOutputRefs: attempt.input.exchange.map(item => item.outputRef) }) : `Answer ${attempt.round}`;
        yield { type: 'RUN_END', requestId: input.requestId, text, model: input.modelId, provider: 'Fixture', usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 } };
      },
    };
    const app = createApp(store, provider, false, runtime, undefined, join(root,'uploads'));
    await request(app).get('/api/workspace').expect(200); await store.backfillJournal();
    const original = await store.read();
    for (const mode of ['independent-review','peer-review','debate','second-opinion']) {
      const record = (await request(app).post('/api/collaborations').send({ prompt: 'Compare fixture', mode, modelIds: ['a','b'], synthesisModelId: 'a' }).expect(201)).body.collaboration;
      const start = calls.length;
      const stream = await request(app).post(`/api/collaborations/${record.id}/stream`).set('Idempotency-Key',`stream-${mode}`).send({}).expect(200);
      expect(stream.headers['content-type']).toContain('text/event-stream');
      expect(stream.text).toContain('COLLABORATION_STATE'); expect(stream.text).toContain('CONTENT_DELTA'); expect(stream.text).toContain('COLLABORATION_COMMIT');
      const finished = (await store.getCollaboration!(record.id))!;
      expect(finished.status).toBe('partial');
      expect(finished.synthesis?.missingParticipants).toMatchObject([{ participantId: 'b', status: 'failed', errorCode: 'PROVIDER_TIMEOUT' }]);
      const rounds = mode === 'peer-review' || mode === 'debate' ? 2 : 1;
      expect(calls.length - start).toBe(rounds * 2 + 1);
      expect(finished.attempts.filter(attempt => attempt.participantId !== '@synthesis' && attempt.round === 1).every(attempt => attempt.input.exchange.length === 0)).toBe(true);
      if (rounds === 2) expect(finished.attempts.find(attempt => attempt.participantId === 'a' && attempt.round === 2)?.input.exchange).toMatchObject([{ text: 'Answer 1' }, { status: 'failed' }]);
      await request(app).post(`/api/collaborations/${record.id}/stream`).set('Idempotency-Key',`stream-${mode}`).send({}).expect(200);
      expect(calls.length - start).toBe(rounds * 2 + 1);
      expect((await store.read()).activeNodeId).toBe(original.activeNodeId);
    }
    const expired = (await request(app).post('/api/collaborations').send({ prompt: 'Expire', mode: 'debate', modelIds: ['a','b'], synthesisModelId: 'a', timeLimitMs: 1 }).expect(201)).body.collaboration;
    const count = calls.length;
    await request(app).post(`/api/collaborations/${expired.id}/stream`).send({}).expect(200);
    expect(calls).toHaveLength(count); expect((await store.getCollaboration!(expired.id))?.status).toBe('budget-exhausted');
    await request(app).get(`/api/v1/workspaces/10000000-0000-4000-8000-000000000099/collaborations/${expired.id}`).expect(403);
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});

it('M16 disconnect durably stops the pass and a concurrent or repeated start cannot dispatch again', async () => {
  const root = await mkdtemp(join(tmpdir(),'rhiza-m16-disconnect-'));
  const store = await openEmbeddedWorkspaceStore(join(root,'db'));
  let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
  try {
    const provider = new ProviderService(new ProviderStore(join(root,'providers')), new SecretVault(join(root,'key')), { baseUrl: 'https://example.test', apiKey: '', model: 'a', providerName: 'Fixture', chatPath: '/chat', timeoutMs: 1000, temperature: 0, extraHeaders: {}, allowNoKey: true });
    const calls: RuntimeRequest[] = []; let ready!: () => void;
    const dispatched = new Promise<void>(resolve => { ready = resolve; });
    const runtime: AIRuntime = { kind: 'provider-adapter', listModels: async () => ['a','b'].map(id => ({ id, model: id, provider: 'Fixture', displayName: id, active: id === 'a' })),
      async *generate(input) {
        calls.push(input); ready();
        await new Promise<void>(resolve => input.signal!.addEventListener('abort', () => resolve(), { once: true }));
        yield { type: 'RUN_END', requestId: input.requestId, text: 'late ignored', model: input.modelId, provider: 'Fixture' };
      },
    };
    const app = createApp(store, provider, false, runtime, undefined, join(root,'uploads'));
    await request(app).get('/api/workspace').expect(200); await store.backfillJournal();
    const record = (await request(app).post('/api/collaborations').send({ prompt: 'Disconnect', mode: 'debate', modelIds: ['a','b'], synthesisModelId: 'a' }).expect(201)).body.collaboration;
    server = app.listen(0,'127.0.0.1');
    await new Promise<void>(resolve => server!.once('listening', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('FIXTURE_ADDRESS_MISSING');
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/collaborations/${record.id}/stream`, { method: 'POST', headers: { 'Idempotency-Key': 'lost-stream' }, signal: controller.signal });
    expect(response.status).toBe(200); await dispatched;
    await request(app).post(`/api/collaborations/${record.id}/stream`).send({}).expect(409);
    controller.abort();
    await vi.waitFor(async () => {
      expect((await store.getCollaboration!(record.id))?.status).toBe('canceled');
      expect((await store.getRun!(calls[0].requestId))?.status).toBe('canceled');
    }, { timeout: 5000, interval: 50 });
    expect(calls).toHaveLength(1);
    expect((await store.read()).manifests.some(item => item.requestId === calls[0].requestId)).toBe(false);
    await request(app).post(`/api/collaborations/${record.id}/stream`).set('Idempotency-Key','lost-stream').send({}).expect(409);
    expect(calls).toHaveLength(1);
  } finally {
    if (server) await new Promise<void>((resolve,reject) => { server!.close(error => error ? reject(error) : resolve()); server!.closeAllConnections(); });
    await store.close(); await rm(root, { recursive: true, force: true });
  }
});
