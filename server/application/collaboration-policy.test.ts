// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createCollaboration, invocationFor, reserveInvocation, settleInvocation, retryInvocation, stopCollaboration, recoverCollaboration, reserveSynthesis, synthesisInput } from './collaboration-policy';

const at = '2026-10-02T00:00:00.000Z';
const base = { workspaceId: 'workspace', nodeId: 'node', contextBaseHash: 'a'.repeat(64), prompt: 'Compare layouts', contextItems: [], history: [], attachmentIds: [] };
const create = (patch: Partial<Parameters<typeof createCollaboration>[0]> = {}) => createCollaboration({ id: 'collaboration', mode: 'debate', models: ['model-a', 'model-b'], synthesisModelId: 'model-a', base, tokenLimit: 100, synthesisTokens: 20, timeLimitMs: 1000, maxRounds: 2, createdAt: at, ...patch });
const reserve = (record: ReturnType<typeof create>, modelId: string, round = 1, attempt = 1, tokens = 30) => reserveInvocation(record, { id: `${modelId}-${round}-${attempt}`, participantId: modelId, round, attempt, runRef: `run-${modelId}-${round}-${attempt}`, manifestRef: `manifest-${modelId}-${round}-${attempt}`, providerEndpointRef: `endpoint-${modelId}`, reservedTokens: tokens, at });

describe('M16 collaboration frozen input and lifecycle policy', () => {
  it('gives every first-round model the same immutable base and no cross-visibility', () => {
    const record = create(); const first = invocationFor(record, 'model-a', 1);
    const running = reserve(record, 'model-a');
    const completed = settleInvocation(running, 'model-a-1-1', { status: 'completed', outputRef: 'output-a', text: 'Private first answer', usedTokens: 10, at });
    const second = invocationFor(completed, 'model-b', 1);
    expect(second.base).toEqual(first.base); expect(second.base.contextBaseHash).toBe(base.contextBaseHash);
    expect(second.exchange).toEqual([]);
    second.base.prompt = 'caller mutation'; expect(record.base.prompt).toBe('Compare layouts');
  });

  it('exchanges only settled previous-round outputs and exposes failed participants to synthesis', () => {
    let record = reserve(create(), 'model-a');
    record = settleInvocation(record, 'model-a-1-1', { status: 'completed', outputRef: 'output-a', text: 'Answer A', usedTokens: 10, at });
    record = reserve(record, 'model-b');
    expect(() => invocationFor(record, 'model-a', 2)).toThrow('COLLABORATION_ROUND_NOT_READY');
    record = settleInvocation(record, 'model-b-1-1', { status: 'failed', errorCode: 'PROVIDER_TIMEOUT', usedTokens: 10, at });
    expect(invocationFor(record, 'model-a', 2).exchange).toMatchObject([{ participantId: 'model-a', status: 'completed', text: 'Answer A' }, { participantId: 'model-b', status: 'failed', errorCode: 'PROVIDER_TIMEOUT' }]);
    expect(synthesisInput(record).missing).toMatchObject([{ participantId: 'model-b', status: 'failed' }]);
  });

  it('reserves synthesis and concurrent participant costs before dispatch and charges unknown usage conservatively', () => {
    let record = reserve(create(), 'model-a', 1, 1, 50);
    expect(() => reserve(record, 'model-b', 1, 1, 31)).toThrow('COLLABORATION_TOKEN_BUDGET');
    record = reserve(record, 'model-b', 1, 1, 30);
    record = settleInvocation(record, 'model-a-1-1', { status: 'completed', outputRef: 'output-a', text: 'A', at });
    expect(record.budget).toMatchObject({ usedTokens: 50, reservedTokens: 30, synthesisTokens: 20 });
    expect(record.attempts[0].usageEstimated).toBe(true);
  });

  it('hard-stops rounds and deadlines, and makes Stop prevent any new dispatch', () => {
    const record = create();
    expect(() => invocationFor(record, 'model-a', 3)).toThrow('COLLABORATION_ROUND_LIMIT');
    expect(() => reserveInvocation(record, { id: 'late', participantId: 'model-a', round: 1, attempt: 1, runRef: 'run', manifestRef: 'manifest', providerEndpointRef: 'endpoint', reservedTokens: 20, at: '2026-10-02T00:00:02.000Z' })).toThrow('COLLABORATION_TIME_BUDGET');
    const stopped = stopCollaboration(reserve(record, 'model-a'), at);
    expect(stopped.status).toBe('canceled'); expect(stopped.attempts[0].status).toBe('canceled');
    expect(() => reserve(stopped, 'model-b')).toThrow('COLLABORATION_STOPPED');
    expect(stopCollaboration(stopped, at)).toEqual(stopped);
  });

  it('retries the frozen original input after restart without repeating committed participants', () => {
    let record = reserve(create(), 'model-a');
    record = settleInvocation(record, 'model-a-1-1', { status: 'completed', outputRef: 'output-a', text: 'A', usedTokens: 10, at });
    record = reserve(record, 'model-b');
    const interrupted = recoverCollaboration(record, at);
    expect(interrupted.attempts.map(attempt => attempt.status)).toEqual(['completed', 'interrupted']);
    const retried = retryInvocation(interrupted, 'model-b-1-1', { id: 'retry-b', runRef: 'retry-run', manifestRef: 'retry-manifest', at });
    expect(retried.attempts.at(-1)?.input).toEqual(record.attempts[1].input);
    expect(retried.attempts.at(-1)?.attempt).toBe(2);
    expect(retried.attempts.filter(attempt => attempt.participantId === 'model-a')).toHaveLength(1);
    expect(() => retryInvocation(interrupted, 'model-a-1-1', { id: 'bad', runRef: 'bad', manifestRef: 'bad', at })).toThrow('COLLABORATION_RETRY_NOT_ALLOWED');
  });
});


it('reopens only an explicit failed participant after partial synthesis and keeps old evidence immutable', () => {
  let record = reserve(create(), 'model-a');
  record = settleInvocation(record, 'model-a-1-1', { status: 'completed', outputRef: 'output-a', text: 'A', usedTokens: 10, at });
  record = settleInvocation(reserve(record, 'model-b'), 'model-b-1-1', { status: 'failed', usedTokens: 10, at });
  record = reserveSynthesis(record, { id: 'synthesis-1', runRef: 'synth-run-1', manifestRef: 'synth-manifest-1', providerEndpointRef: 'endpoint-a', at });
  record = settleInvocation(record, 'synthesis-1', { status: 'completed', outputRef: 'summary-old', text: 'A with B missing', usedTokens: 10, at });
  record.status = 'partial';
  record.synthesis = { recommendation: 'A', rationale: 'B missing', alternatives: [], risks: [], disagreements: [], sourceOutputRefs: ['output-a'], missingParticipants: [{ participantId: 'model-b', status: 'failed' }] };
  const original = structuredClone(record);
  expect(() => reserveSynthesis(record, { id: 'duplicate', runRef: 'duplicate', manifestRef: 'duplicate', providerEndpointRef: 'endpoint-a', at })).toThrow('COLLABORATION_ATTEMPT_CONFLICT');
  let retried = retryInvocation(record, 'model-b-1-1', { id: 'retry-b', runRef: 'retry-run', manifestRef: 'retry-manifest', at });
  expect(retried.status).toBe('running'); expect(retried.synthesis).toBeUndefined();
  expect(retried.attempts.at(-1)?.input).toEqual(original.attempts[1].input);
  retried = settleInvocation(retried, 'retry-b', { status: 'completed', outputRef: 'output-b', text: 'B', usedTokens: 10, at });
  const next = reserveSynthesis(retried, { id: 'synthesis-2', runRef: 'synth-run-2', manifestRef: 'synth-manifest-2', providerEndpointRef: 'endpoint-a', at });
  expect(next.attempts.at(-1)?.input.exchange.map(item => item.outputRef)).toEqual(['output-a', 'output-b']);
  expect(next.attempts.at(-1)?.attempt).toBe(2);
  expect(next.attempts.filter(item => item.participantId === 'model-a')).toHaveLength(1);
  expect(record).toEqual(original); expect(next.attempts.find(item => item.id === 'synthesis-1')?.text).toBe('A with B missing');
  expect(() => retryInvocation({ ...record, cancelRequestedAt: at }, 'model-b-1-1', { id: 'stopped', runRef: 'stopped', manifestRef: 'stopped', at })).toThrow('COLLABORATION_STOPPED');
  expect(() => retryInvocation(record, 'model-b-1-1', { id: 'late', runRef: 'late', manifestRef: 'late', at: '2026-10-02T00:00:02.000Z' })).toThrow('COLLABORATION_TIME_BUDGET');
});
