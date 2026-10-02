// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { api } from '../src/api';
import { createApp } from '../server/app';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { ProviderService } from '../server/provider-service';
import { ProviderStore } from '../server/provider-store';
import { SecretVault } from '../server/secret-vault';
import type { AIRuntime, RuntimeRequest } from '../server/ai-runtime';

it('connects the UI client through scoped HTTP selection, frozen provenance and guarded Replay without dispatching during inspection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m15-ui-client-'));
  const store = await openEmbeddedWorkspaceStore(join(root, 'db'));
  const calls: RuntimeRequest[] = [];
  const provider = new ProviderService(new ProviderStore(join(root, 'providers')), new SecretVault(join(root, 'key')), { baseUrl: 'https://example.test', apiKey: '', model: 'fixture', providerName: 'Fixture', chatPath: '/chat', timeoutMs: 1000, temperature: 0, extraHeaders: {}, allowNoKey: true });
  const runtime: AIRuntime = {
    kind: 'provider-adapter', listModels: async () => [{ id: 'fixture', model: 'fixture', provider: 'Fixture', displayName: 'Fixture', active: true }],
    async *generate(input) {
      calls.push(input);
      yield { type: 'RUN_START', requestId: input.requestId, manifestId: input.manifestId, model: 'fixture', provider: 'Fixture' };
      yield { type: 'RUN_END', requestId: input.requestId, text: 'Offline answer', model: 'fixture', provider: 'Fixture' };
    },
  };
  const app = createApp(store, provider, false, runtime, undefined, join(root, 'uploads'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const nativeFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => nativeFetch(`${origin}${path}`, init));
  try {
    api.setWorkspace();
    const { workspace } = await api.getWorkspace();
    api.setWorkspace(workspace.projectId);
    const { workspace: created } = await api.createGraphNode({ title: 'Payment evidence', summary: 'payment idempotency', x: 100, y: 100 });
    const source = created.discussionNodes.find(node => node.title === 'Payment evidence')!;
    const before = await api.getWorkspaceActivity();
    const preview = await api.getContextPreview('payment');
    const recommended = preview.recommendations.find(item => item.sourceId === source.id)!;
    expect(recommended.sourceRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(await api.getWorkspaceActivity()).toEqual(before);
    expect(calls).toHaveLength(0);
    const decision = { sourceType: 'node' as const, sourceId: source.id, sourceRevision: recommended.sourceRevision!, decision: 'accept' as const, reason: '本轮采用这份证据' };
    await api.decideContextRecommendation(decision, 'reviewed-selection');
    await api.decideContextRecommendation(decision, 'reviewed-selection');
    expect((await api.getContextPreview('payment')).items.filter(item => item.sourceId === source.id)).toHaveLength(1);
    expect(calls).toHaveLength(0);

    const turn = await api.sendMessage('payment');
    const provenance = await api.getProvenance(turn.assistantMessage.id);
    const history = await api.getManifestContext(provenance.contextManifestRef!);
    expect(history).toEqual(await api.getMessageContext(turn.assistantMessage.id));
    expect(history.manifest.contextItems).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: source.id, selectionMode: 'AI_RECOMMENDED_ACCEPTED', reason: decision.reason })]));
    expect(history.sources.every(item => item.status === 'resolved')).toBe(true);
    const preflight = await api.getReplayPreflight(provenance.runRef!);
    expect(preflight.policies.find(item => item.policy === 'exact')).toMatchObject({ allowed: true });
    expect(calls).toHaveLength(1);
    await api.replayRun(provenance.runRef!, 'exact', 'explicit-replay');
    await api.replayRun(provenance.runRef!, 'exact', 'explicit-replay');
    expect(calls).toHaveLength(2);
    expect(await api.getManifestContext(provenance.contextManifestRef!)).toEqual(history);

    await api.renameConversation(source.id, 'Payment evidence changed');
    await expect(api.decideContextRecommendation(decision, 'stale-review')).rejects.toMatchObject({ code: 'CONTEXT_SELECTION_STALE', status: 409 });
    expect(calls).toHaveLength(2);
  } finally {
    api.setWorkspace(); vi.unstubAllGlobals();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await store.close(); await rm(root, { recursive: true, force: true });
  }
}, 30000);

it('keeps inline collaboration in its conversation across partial result, single-model retry, resynthesis, retention and follow-up', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-inline-ui-client-'));
  const store = await openEmbeddedWorkspaceStore(join(root, 'db'));
  const calls: RuntimeRequest[] = []; let failB = true;
  const provider = new ProviderService(new ProviderStore(join(root, 'providers')), new SecretVault(join(root, 'key')), { baseUrl: 'https://example.test', apiKey: '', model: 'a', providerName: 'Fixture', chatPath: '/chat', timeoutMs: 1000, temperature: 0, extraHeaders: {}, allowNoKey: true });
  const runtime: AIRuntime = { kind: 'provider-adapter', listModels: async () => ['a', 'b'].map(id => ({ id, model: id, provider: 'Fixture', displayName: id, active: id === 'a' })), async *generate(input) {
    calls.push(input);
    if (input.modelId === 'b' && failB) { yield { type: 'RUN_ERROR', requestId: input.requestId, code: 'PROVIDER_TIMEOUT', message: 'Fixture B failed', status: 504 }; return; }
    const record = (await store.listCollaborations!()).find(record => record.attempts.some(attempt => attempt.runRef === input.requestId));
    const attempt = record?.attempts.find(attempt => attempt.runRef === input.requestId);
    const text = attempt?.participantId === '@synthesis' ? JSON.stringify({ recommendation: `Advice with ${attempt.input.exchange.length} models`, rationale: 'Offline evidence', alternatives: [], risks: [], disagreements: [], sourceOutputRefs: attempt.input.exchange.flatMap(item => item.outputRef ? [item.outputRef] : []) }) : `Answer ${input.modelId}`;
    yield { type: 'RUN_END', requestId: input.requestId, text, model: input.modelId, provider: 'Fixture', usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 } };
  } };
  const app = createApp(store, provider, false, runtime, undefined, join(root, 'uploads'));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; const nativeFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => nativeFetch(`${origin}${path}`, init));
  try {
    api.setWorkspace(); const { workspace } = await api.getWorkspace(); api.setWorkspace(workspace.projectId);
    const input = { prompt: 'Review current answer', mode: 'second-opinion' as const, modelIds: ['a', 'b'], synthesisModelId: 'a', attachmentIds: [], maxRounds: 1 };
    const created = await api.createCollaboration(input, 'inline-create');
    expect((await api.createCollaboration(input, 'inline-create')).collaboration.id).toBe(created.collaboration.id);
    const events: string[] = [];
    const { collaboration: partial } = await api.streamCollaboration(created.collaboration.id, event => events.push(event.type), 'inline-run', new AbortController().signal);
    expect(partial.status).toBe('partial'); expect(events).toContain('COLLABORATION_STATE'); expect(calls).toHaveLength(3);
    await api.streamCollaboration(partial.id, () => {}, 'inline-run', new AbortController().signal); expect(calls).toHaveLength(3);
    expect((await api.getWorkspace()).workspace.activeNodeId).toBe(workspace.activeNodeId);
    expect((await api.getWorkspace()).workspace.messages.filter(message => message.nodeId === workspace.activeNodeId)).toEqual(workspace.messages.filter(message => message.nodeId === workspace.activeNodeId));
    const failed = partial.attempts.find(attempt => attempt.participantId === 'b')!;
    const firstSynthesis = partial.attempts.find(attempt => attempt.participantId === '@synthesis')!;
    failB = false;
    const retry = await api.retryCollaborationParticipant(partial.id, failed.id, 'inline-retry-b', new AbortController().signal);
    await api.retryCollaborationParticipant(partial.id, failed.id, 'inline-retry-b', new AbortController().signal);
    expect(calls).toHaveLength(4); expect(retry.collaboration.synthesis).toBeUndefined();
    expect(calls.filter(call => call.modelId === 'a' && !call.prompt.startsWith('Synthesize collaboration'))).toHaveLength(1);
    const summary = await api.synthesizeCollaboration(partial.id, 'inline-synthesis-2', new AbortController().signal);
    expect(summary.collaboration.status).toBe('completed'); expect(summary.collaboration.synthesis?.missingParticipants).toEqual([]);
    expect(calls).toHaveLength(5);
    await expect(api.synthesizeCollaboration(partial.id, 'duplicate-new-key', new AbortController().signal)).rejects.toMatchObject({ code: 'COLLABORATION_ATTEMPT_CONFLICT' }); expect(calls).toHaveLength(5);
    const latest = summary.collaboration.attempts.filter(attempt => attempt.participantId === '@synthesis').at(-1)!;
    const retained = await api.retainCollaboration(partial.id, workspace.activeNodeId, 'inline-retain');
    expect((await api.retainCollaboration(partial.id, workspace.activeNodeId, 'inline-retain')).message.id).toBe(retained.message.id);
    expect(retained.message.sourceMessageId).toBe(latest.outputRef);
    expect(retained.message.text).toContain(summary.collaboration.synthesis!.recommendation);
    expect(retained.message.text).not.toContain('"missingParticipants"');
    expect((await store.read()).messages.find(message => message.id === firstSynthesis.outputRef)?.text).toBe(firstSynthesis.text);
    expect((await api.getWorkspace()).workspace.activeNodeId).toBe(workspace.activeNodeId);
    await api.sendMessage('Continue from retained advice'); expect(calls).toHaveLength(6);
    expect(calls.at(-1)?.history.some(message => message.id === retained.message.id)).toBe(true);
    expect(calls.at(-1)?.history.some(message => message.id === latest.outputRef)).toBe(false);
  } finally {
    api.setWorkspace(); vi.unstubAllGlobals();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await store.close(); await rm(root, { recursive: true, force: true });
  }
}, 30000);
