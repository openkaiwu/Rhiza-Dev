import type { FrozenCollaborationBase, CollaborationMode, CollaborationRecord, CollaborationExchange, CollaborationAttempt, CollaborationInvocation, CollaborationModelSnapshot } from '../contracts/collaboration';
import type { ContextEnvelope } from '../execution-runtime/run';
export type { FrozenCollaborationBase, CollaborationMode, CollaborationRecord, CollaborationExchange, CollaborationAttempt, CollaborationInvocation } from '../contracts/collaboration';

export interface CollaborationConfig {
  id: string; mode: CollaborationMode; models: string[]; synthesisModelId: string; base: FrozenCollaborationBase;
  tokenLimit?: number; synthesisTokens?: number; timeLimitMs?: number; maxRounds?: number; createdAt: string;
  modelsSnapshot?: CollaborationModelSnapshot[];
}

function fail(code: string): never { throw Object.assign(new Error(code), { code, status: 409 }); }
const count = (value: number, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const validRef = (value: string) => typeof value === 'string' && value.length > 0 && value.length <= 200;
const active = (record: CollaborationRecord) => {
  if (record.cancelRequestedAt || !['running', 'interrupted'].includes(record.status)) fail('COLLABORATION_STOPPED');
};
const latest = (record: CollaborationRecord, participantId: string, round: number) =>
  record.attempts.filter(value => value.participantId === participantId && value.round === round).at(-1);

export function createCollaboration(config: CollaborationConfig): CollaborationRecord {
  const tokenLimit = config.tokenLimit ?? 32_000;
  const synthesisTokens = config.synthesisTokens ?? 4_096;
  const timeLimitMs = config.timeLimitMs ?? 180_000;
  const maxRounds = config.maxRounds ?? (['debate', 'peer-review'].includes(config.mode) ? 2 : 1);
  if (!validRef(config.id) || !validRef(config.base.workspaceId) || !validRef(config.base.nodeId)
    || !['independent-review', 'peer-review', 'debate', 'second-opinion'].includes(config.mode)
    || !Array.isArray(config.models) || config.models.length < 2 || config.models.length > 4 || config.models.some(model => !validRef(model))
    || new Set(config.models).size !== config.models.length || !validRef(config.synthesisModelId)
    || !/^[a-f0-9]{64}$/.test(config.base.contextBaseHash) || config.base.contextItems.some(item => item.status !== 'active')
    || !count(tokenLimit, 1) || !count(synthesisTokens, 1) || synthesisTokens >= tokenLimit || !count(timeLimitMs, 1)
    || !count(maxRounds, 1) || maxRounds > 5 || !Number.isFinite(Date.parse(config.createdAt))) fail('INVALID_COLLABORATION_CONFIG');
  for (const attachmentId of config.base.attachmentIds) {
    const attachment = config.base.attachments?.find(item => item.id === attachmentId);
    if (!attachment?.resourceVersionId || !attachment.digest || !attachment.blobRef) fail('COLLABORATION_ATTACHMENT_NOT_FROZEN');
  }
  return structuredClone({ id: config.id, workspaceId: config.base.workspaceId, nodeId: config.base.nodeId, revision: 1,
    mode: config.mode, participants: config.models, synthesisModelId: config.synthesisModelId, base: config.base, status: 'running', createdAt: config.createdAt,
    budget: { tokenLimit, synthesisTokens, usedTokens: 0, reservedTokens: 0, deadlineAt: new Date(Date.parse(config.createdAt) + timeLimitMs).toISOString(), maxRounds }, attempts: [], ...(config.modelsSnapshot ? { models: config.modelsSnapshot } : {}) });
}

export function invocationFor(record: CollaborationRecord, participantId: string, round: number): CollaborationInvocation {
  active(record);
  if (!record.participants.includes(participantId)) fail('COLLABORATION_PARTICIPANT_NOT_FOUND');
  if (!count(round, 1) || round > record.budget.maxRounds) fail('COLLABORATION_ROUND_LIMIT');
  // Even an already completed first-round answer is private to its participant.
  if (round === 1) return structuredClone({ base: record.base, exchange: [] });
  const previous = record.participants.map(id => latest(record, id, round - 1));
  if (previous.some(value => !value || value.status === 'running')) fail('COLLABORATION_ROUND_NOT_READY');
  const exchange = record.mode === 'independent-review' ? [] : previous.map(value => exchangeOutput(value!));
  return structuredClone({ base: record.base, exchange });
}

interface Reservation {
  id: string; participantId: string; round: number; attempt: number; runRef: string; manifestRef: string;
  providerEndpointRef: string; reservedTokens: number; at: string;
}
function reserve(record: CollaborationRecord, reservation: Reservation, input: CollaborationInvocation): CollaborationRecord {
  active(record);
  if (!Number.isFinite(Date.parse(reservation.at)) || Date.parse(reservation.at) >= Date.parse(record.budget.deadlineAt)) fail('COLLABORATION_TIME_BUDGET');
  if (![reservation.id, reservation.runRef, reservation.manifestRef, reservation.providerEndpointRef].every(validRef)
    || !count(reservation.attempt, 1) || !count(reservation.reservedTokens, 1)) fail('INVALID_COLLABORATION_RESERVATION');
  if (record.attempts.some(value => value.id === reservation.id || value.runRef === reservation.runRef || value.manifestRef === reservation.manifestRef)) fail('COLLABORATION_ATTEMPT_CONFLICT');
  if (record.budget.usedTokens + record.budget.reservedTokens + record.budget.synthesisTokens + reservation.reservedTokens > record.budget.tokenLimit) fail('COLLABORATION_TOKEN_BUDGET');
  const next = structuredClone(record);
  next.revision += 1; next.status = 'running'; next.budget.reservedTokens += reservation.reservedTokens;
  next.attempts.push({ id: reservation.id, participantId: reservation.participantId, round: reservation.round, attempt: reservation.attempt,
    runRef: reservation.runRef, manifestRef: reservation.manifestRef, providerEndpointRef: reservation.providerEndpointRef,
    reservedTokens: reservation.reservedTokens, startedAt: reservation.at, status: 'running', input: structuredClone(input) });
  return next;
}

export function reserveInvocation(record: CollaborationRecord, reservation: Reservation): CollaborationRecord {
  if (latest(record, reservation.participantId, reservation.round) || reservation.attempt !== 1) fail('COLLABORATION_ATTEMPT_CONFLICT');
  return reserve(record, reservation, invocationFor(record, reservation.participantId, reservation.round));
}

export function settleInvocation(record: CollaborationRecord, attemptId: string, result: {
  status: 'completed' | 'failed' | 'canceled' | 'interrupted'; usedTokens?: number; outputRef?: string; text?: string; errorCode?: string; at: string;
}): CollaborationRecord {
  const next = structuredClone(record);
  const attempt = next.attempts.find(value => value.id === attemptId);
  if (!attempt) fail('COLLABORATION_ATTEMPT_NOT_FOUND');
  if (attempt.status !== 'running') fail('COLLABORATION_ATTEMPT_TERMINAL');
  if (!Number.isFinite(Date.parse(result.at)) || (result.usedTokens !== undefined && !count(result.usedTokens))
    || (result.status === 'completed' && (!result.outputRef || typeof result.text !== 'string'))) fail('INVALID_COLLABORATION_RESULT');
  next.revision += 1;
  next.budget.reservedTokens -= attempt.reservedTokens;
  attempt.status = result.status; attempt.terminalAt = result.at;
  attempt.usedTokens = result.usedTokens ?? attempt.reservedTokens; attempt.usageEstimated = result.usedTokens === undefined;
  next.budget.usedTokens += attempt.usedTokens;
  if (result.status === 'completed') { attempt.outputRef = result.outputRef; attempt.text = result.text; }
  else attempt.errorCode = result.errorCode ?? (result.status === 'interrupted' ? 'PROCESS_INTERRUPTED' : 'RUNTIME_ERROR');
  if (next.budget.usedTokens + next.budget.reservedTokens + next.budget.synthesisTokens > next.budget.tokenLimit) next.status = 'budget-exhausted';
  return next;
}

export function retryInvocation(record: CollaborationRecord, attemptId: string, refs: { id: string; runRef: string; manifestRef: string; at: string }): CollaborationRecord {
  const prior = record.attempts.find(value => value.id === attemptId);
  if (!prior || !['failed', 'interrupted', 'canceled'].includes(prior.status) || latest(record, prior.participantId, prior.round)?.id !== prior.id) fail('COLLABORATION_RETRY_NOT_ALLOWED');
  // Do not rebuild the exchange from newer results; this attempt's input is frozen.
  const available = structuredClone(record);
  // Explicit participant Retry may reopen a partial result. Stop, deadlines and
  // reservations still pass through reserve; no completed participant repeats.
  if (!record.cancelRequestedAt && ['partial', 'failed'].includes(record.status)) available.status = 'running';
  const next = reserve(available, { ...refs, participantId: prior.participantId, round: prior.round, attempt: prior.attempt + 1, providerEndpointRef: prior.providerEndpointRef, reservedTokens: prior.reservedTokens }, prior.input);
  if (prior.participantId !== '@synthesis') delete next.synthesis;
  return next;
}

export function stopCollaboration(record: CollaborationRecord, at: string): CollaborationRecord {
  if (record.cancelRequestedAt || ['completed', 'partial', 'failed'].includes(record.status)) return structuredClone(record);
  if (!Number.isFinite(Date.parse(at))) fail('INVALID_COLLABORATION_RESULT');
  let next = structuredClone(record);
  for (const attempt of record.attempts.filter(value => value.status === 'running')) next = settleInvocation(next, attempt.id, { status: 'canceled', errorCode: 'GENERATION_STOPPED', at });
  next.status = 'canceled'; next.cancelRequestedAt = at; next.revision += 1;
  return next;
}

export function recoverCollaboration(record: CollaborationRecord, at: string): CollaborationRecord {
  if (!['running', 'synthesizing'].includes(record.status)) return structuredClone(record);
  let next = structuredClone(record);
  for (const attempt of record.attempts.filter(value => value.status === 'running')) next = settleInvocation(next, attempt.id, { status: 'interrupted', errorCode: 'PROCESS_INTERRUPTED', at });
  next.status = 'interrupted'; next.revision += 1;
  return next;
}

function exchangeOutput(attempt: CollaborationAttempt): CollaborationExchange {
  return { participantId: attempt.participantId, round: attempt.round, status: attempt.status, runRef: attempt.runRef,
    manifestRef: attempt.manifestRef, providerEndpointRef: attempt.providerEndpointRef,
    ...(attempt.status === 'completed' ? { outputRef: attempt.outputRef, text: attempt.text } : { errorCode: attempt.errorCode }) };
}

export function synthesisInput(record: CollaborationRecord) {
  const lastRound = Math.max(1, ...record.attempts.filter(value => value.participantId !== '@synthesis').map(value => value.round));
  const attempts = record.participants.map(participantId => latest(record, participantId, lastRound));
  if (attempts.some(value => value?.status === 'running')) fail('COLLABORATION_ROUND_NOT_READY');
  return structuredClone({ contextBaseHash: record.base.contextBaseHash,
    outputs: record.participants.flatMap(participantId => {
      const completed = record.attempts.filter(value => value.participantId === participantId && value.status === 'completed').at(-1);
      return completed ? [exchangeOutput(completed)] : [];
    }),
    missing: record.participants.flatMap((participantId, index) => attempts[index]?.status === 'completed' ? [] : [{ participantId, status: attempts[index]?.status ?? 'not-dispatched', errorCode: attempts[index]?.errorCode }]) });
}

export function reserveSynthesis(record: CollaborationRecord, refs: { id: string; runRef: string; manifestRef: string; providerEndpointRef: string; at: string }) {
  const input = synthesisInput(record);
  if (!input.outputs.length) fail('COLLABORATION_SYNTHESIS_NO_EVIDENCE');
  const previous = record.attempts.filter(attempt => attempt.participantId === '@synthesis').at(-1);
  if (previous && (previous.status === 'running' || JSON.stringify([previous.input.exchange.map(item => item.outputRef), previous.input.missingParticipants ?? []]) === JSON.stringify([input.outputs.map(item => item.outputRef), input.missing]))) fail('COLLABORATION_ATTEMPT_CONFLICT');
  const available = structuredClone(record);
  const reservedTokens = previous?.reservedTokens ?? available.budget.synthesisTokens;
  available.budget.synthesisTokens = 0;
  const next = reserve(available, { ...refs, participantId: '@synthesis', round: 1, attempt: (previous?.attempt ?? 0) + 1, reservedTokens }, { base: record.base, exchange: input.outputs, missingParticipants: input.missing });
  next.status = 'synthesizing';
  return next;
}

/** Storage locations and executor identities do not change the frozen collaboration base. */
export function collaborationHashInput(base: FrozenCollaborationBase): ContextEnvelope {
  return { schemaVersion: '1.0.0', executor: { runtime: 'collaboration-base.v1', modelSpecRef: 'base', providerEndpointRef: 'base', model: 'base', provider: 'base' },
    request: { requestId: 'collaboration-base', manifestId: 'collaboration-base', projectId: base.workspaceId, nodeId: base.nodeId, modelId: 'collaboration-base',
      prompt: base.prompt, history: base.history, contextItems: base.contextItems, mode: base.mode ?? 'Strict', generation: base.generation, operation: 'send',
      attachments: base.attachments?.map(({ blobRef: _blobRef, ...attachment }) => attachment) } };
}

/** Every frozen copy stays protected until the owning collaboration branch is purged with it. */
export function assertCollaborationPurge(records: CollaborationRecord[], nodeId: string, affectedIds: ReadonlySet<string>) {
  for (const record of records) {
    if (record.nodeId === nodeId) {
      if (['running','synthesizing'].includes(record.status) || record.attempts.some(attempt => attempt.status === 'running')) fail('PURGE_HAS_ACTIVE_COLLABORATION');
      continue;
    }
    const bases = [record.base, ...record.attempts.map(attempt => attempt.input.base)];
    if (bases.some(base => affectedIds.has(base.nodeId)
      || base.history.some(message => [message.id, message.nodeId, message.manifestId, message.sourceMessageId, message.replyToMessageId].some(ref => ref && affectedIds.has(ref)) || message.attachmentIds?.some(ref => affectedIds.has(ref)))
      || base.contextItems.some(item => [item.id,item.sourceId,item.sourceNodeId].some(ref => ref && affectedIds.has(ref)))
      || base.attachments?.some(item => [item.id,item.resourceId,item.resourceVersionId].some(ref => ref && affectedIds.has(ref))))
      || record.attempts.some(attempt => affectedIds.has(attempt.outputRef ?? '') || affectedIds.has(attempt.manifestRef)
        || attempt.input.exchange.some(item => [item.outputRef,item.manifestRef,item.runRef].some(ref => ref && affectedIds.has(ref))))) fail('PURGE_HAS_COLLABORATION_REFERENCE');
  }
}
