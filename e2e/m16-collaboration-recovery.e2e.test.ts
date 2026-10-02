// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect, it, vi } from 'vitest';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { createApp } from '../server/app';
import { ProviderService } from '../server/provider-service';
import { ProviderStore } from '../server/provider-store';
import { SecretVault } from '../server/secret-vault';
import type { AIRuntime, RuntimeRequest } from '../server/ai-runtime';
import { RepositoryWorkspaceUnitOfWork } from '../server/infrastructure/workspace-repository-unit-of-work';
import { semanticChecksum, semanticStateChecksum } from '../server/infrastructure/workspace-semantic-checksum';
import { reserveInvocation } from '../server/application/collaboration-policy';
import type { WorkspaceData } from '../server/domain';
import type { SqlQueryable } from '../server/postgres-store';
import type { WorkspaceUpdateOptions } from '../server/store';

it('M16 Stop cancels an active Run, startup interrupts without dispatch, and failed persistence leaves no half-commit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m16-recovery-'));
  const store = await openEmbeddedWorkspaceStore(join(root,'db'));
  try {
    const provider = new ProviderService(new ProviderStore(join(root,'providers')), new SecretVault(join(root,'key')), { baseUrl: 'https://example.test', apiKey: '', model: 'a', providerName: 'Fixture', chatPath: '/chat', timeoutMs: 1000, temperature: 0, extraHeaders: {}, allowNoKey: true });
    let started!: () => void; const dispatch = new Promise<void>(resolve => { started = resolve; });
    const calls: RuntimeRequest[] = []; let hold = true;
    let parallel = false; let pairCount = 0; let releasePair!: () => void; let participantReady: (() => void) | undefined;
    const pairBarrier = new Promise<void>(resolve => { releasePair = resolve; });
    const runtime: AIRuntime = { kind: 'provider-adapter', listModels: async () => ['a','b'].map(id => ({ id, model: id, provider: 'Fixture', displayName: id, active: id === 'a' })),
      async *generate(input) {
        calls.push(input); started();
        participantReady?.();
        if (parallel) { if (++pairCount === 2) releasePair(); await pairBarrier; }
        if (hold) await new Promise<void>(resolve => { input.signal!.addEventListener('abort', () => resolve(), { once: true }); });
        yield { type: 'RUN_END', requestId: input.requestId, text: 'fixture answer', model: input.modelId, provider: 'Fixture' };
      },
    };
    const app = createApp(store, provider, false, runtime, undefined, join(root,'uploads'));
    await request(app).get('/api/workspace').expect(200); await store.backfillJournal();
    const create = () => request(app).post('/api/collaborations').send({ prompt: 'fixture', mode: 'independent-review', modelIds: ['a','b'], synthesisModelId: 'a' });
    const record = (await create().expect(201)).body.collaboration;
    const running = request(app).post(`/api/collaborations/${record.id}/invoke`).send({ participantId: 'a', round: 1 }).then(response => response);
    await dispatch;
    await request(app).post(`/api/collaborations/${record.id}/stop`).set('Idempotency-Key','stop-active').send({}).expect(200);
    expect((await running).status).toBe(499);
    expect((await store.getRun!(calls[0].requestId))?.status).toBe('canceled');
    expect((await store.getCollaboration!(record.id))?.attempts[0].status).toBe('canceled');
    expect((await store.read()).manifests.some(manifest => manifest.requestId === calls[0].requestId)).toBe(false);
    await request(app).post(`/api/collaborations/${record.id}/stop`).set('Idempotency-Key','stop-active').send({}).expect(200);
    expect(calls).toHaveLength(1);

    const recoverable = (await create().expect(201)).body.collaboration;
    const next = reserveInvocation(recoverable, { id: randomUUID(), participantId: 'a', round: 1, attempt: 1, runRef: randomUUID(), manifestRef: randomUUID(), providerEndpointRef: 'a', reservedTokens: 2048, at: new Date().toISOString() });
    const attempt = next.attempts[0];
    const input = { schemaVersion: '1.0.0' as const, executor: { runtime: 'provider-adapter', modelSpecRef: 'a', providerEndpointRef: 'a', model: 'a', provider: 'Fixture' },
      request: { requestId: attempt.runRef, manifestId: attempt.manifestRef, projectId: next.workspaceId, nodeId: next.nodeId, modelId: 'a', prompt: next.base.prompt, contextItems: next.base.contextItems, history: next.base.history, mode: next.base.mode ?? 'Strict' } };
    const uow = new RepositoryWorkspaceUnitOfWork(store);
    await uow.withWorkspace(next.workspaceId, () => uow.withCommand({ commandId: 'crash-after-reserve', commandType: 'InvokeCollaboration', actor: { actorType: 'human', actorId: '00000000-0000-4000-8000-000000000002' }, scope: { scopeType: 'workspace', scopeId: next.workspaceId }, occurredAt: new Date().toISOString() }, async () => {
      await uow.execute({ policy: { kind: 'normal' }, collaboration: { expectedRevision: recoverable.revision, next }, run: { kind: 'create', run: { id: attempt.runRef, workspaceId: next.workspaceId, nodeId: next.nodeId, commandId: 'crash-after-reserve', status: 'created', attempt: 1, input, inputHash: semanticStateChecksum(input), createdAt: new Date().toISOString(), telemetry: { traceCount: 0 } } }, apply: current => ({ next: current, value: { runId: attempt.runRef } }) });
    }));
    expect(await store.reconcileRuns()).toBe(1);
    expect((await store.getRun!(attempt.runRef))?.status).toBe('interrupted');
    expect((await store.getCollaboration!(recoverable.id))?.status).toBe('interrupted');
    expect(await store.reconcileRuns()).toBe(0); expect(calls).toHaveLength(1);
    hold = false;
    await request(app).post(`/api/collaborations/${recoverable.id}/retry`).send({ attemptId: attempt.id }).expect(201);
    expect(calls).toHaveLength(2);
    expect((await store.getCollaboration!(recoverable.id))?.attempts.at(-1)?.input).toEqual(attempt.input);

    const pair = (await create().expect(201)).body.collaboration;
    parallel = true;
    const firstReady = new Promise<void>(resolve => { participantReady = resolve; });
    const invokeA = request(app).post(`/api/collaborations/${pair.id}/invoke`).send({ participantId: 'a', round: 1 }).then(response => response);
    await firstReady; participantReady = undefined;
    const invokeB = request(app).post(`/api/collaborations/${pair.id}/invoke`).send({ participantId: 'b', round: 1 }).then(response => response);
    expect((await Promise.all([invokeA,invokeB])).map(response => response.status)).toEqual([201,201]);
    expect((await store.getCollaboration!(pair.id))?.attempts.map(attempt => attempt.status)).toEqual(['completed','completed']);
    expect(calls).toHaveLength(4); parallel = false;

    const before = semanticChecksum(await store.read());
    const records = await store.listCollaborations!();
    const internal = store as unknown as { persist(database: SqlQueryable, workspace: WorkspaceData, previous?: WorkspaceData, options?: WorkspaceUpdateOptions): Promise<void> };
    const persist = internal.persist.bind(internal);
    const fault = vi.spyOn(internal,'persist').mockImplementationOnce(async (...args) => { await persist(...args); throw new Error('injected write failure after SQL state'); });
    try { await create().expect(500); } finally { fault.mockRestore(); }
    expect(semanticChecksum(await store.read())).toBe(before);
    expect(await store.listCollaborations!()).toEqual(records); expect(calls).toHaveLength(4);
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});
