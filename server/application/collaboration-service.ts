import type { CommandEnvelope, CommandExecutionOptions, CommandMap, CreateConversationRunResult } from '../contracts/application';
import { applicationError } from '../contracts/application-error';
import type { ContextEnvelope, RunMutation } from '../execution-runtime/run';
import type { RuntimePort, RuntimeRequest, RuntimeEvent } from './ports/runtime';
import type { WorkspaceMutation, WorkspaceUnitOfWork } from './ports/workspace-unit-of-work';
import type { PreparedRun } from './prepared-run';
import { RunLifecycle } from './run-lifecycle';
import { estimateTokens } from '../context-runtime/port';
import { collaborationHashInput, createCollaboration, reserveInvocation, reserveSynthesis, retryInvocation, settleInvocation, stopCollaboration, type CollaborationRecord, type CollaborationAttempt } from './collaboration-policy';
import { parseCollaborationSynthesis } from './collaboration-synthesis';

type Completion = Extract<RuntimeEvent, { type: 'RUN_END' }>;
interface Dependencies {
  unitOfWork: WorkspaceUnitOfWork; runtime: RuntimePort; runs: RunLifecycle; id(): string; now(): string;
  hash(input: ContextEnvelope): string; inputFor(request: RuntimeRequest): ContextEnvelope;
  blobs: import('./ports/host-runtime').BlobStorePort;
  prepare(payload: CommandMap['CreateConversationRun']['payload']): Promise<PreparedRun>;
  commit(run: PreparedRun, completion: Completion, mutation?: RunMutation, collaboration?: WorkspaceMutation<unknown>['collaboration'], outputId?: string): Promise<CreateConversationRunResult>;
}
const conflict = (code: string) => applicationError('协作状态已变化，请刷新后重试。', code, 'conflict', 'none', false, 409);

/** Application-owned collaboration; it reuses local Chat execution and never schedules external workflow effects. */
export class CollaborationService {
  constructor(private readonly deps: Dependencies) {}
  private get uow() { return this.deps.unitOfWork; }
  private async record(id: string) {
    const record = await this.uow.getCollaboration?.(id);
    if (!record) throw applicationError('协作记录不存在。', 'COLLABORATION_NOT_FOUND', 'not_found', 'none', false, 404);
    return record;
  }
  async get(id: string) { return { collaboration: await this.record(id) }; }

  private child<K extends keyof CommandMap, T>(parent: CommandEnvelope<'RunCollaboration'>, suffix: string, commandType: K,
    payload: CommandMap[K]['payload'], operation: (envelope: CommandEnvelope<K>) => Promise<T>) {
    const child: CommandEnvelope<K> = { ...parent, expectedRevision: undefined, commandId: `${parent.commandId}:${suffix}`, commandType, payload };
    return this.uow.withCommand!({ commandId: child.commandId, commandType, actor: parent.actor, scope: parent.scope, occurredAt: this.deps.now(), correlationId: parent.correlationId }, () => operation(child));
  }

  /** One explicitly started, finite pass. Interrupted work requires participant Retry, never implicit replay. */
  async run(envelope: CommandEnvelope<'RunCollaboration'>, options?: CommandExecutionOptions) {
    const previous = await this.uow.readCommittedResult?.<CommandMap['RunCollaboration']['result']>();
    if (previous?.found) { await options?.onReady?.(); return previous.value; }
    const initial = await this.record(envelope.payload.collaborationId);
    if (['completed','partial'].includes(initial.status)) { await options?.onReady?.(); return { collaboration: initial }; }
    if (initial.status !== 'running' || initial.attempts.length) throw conflict('COLLABORATION_REQUIRES_MANUAL_REVIEW');
    // A single receipt claims the pass across concurrent HTTP requests; a lost response never starts another pass.
    const executionId = this.deps.id();
    const claimed = { ...structuredClone(initial), revision: initial.revision + 1 };
    const claim = await this.uow.withCommand!({ commandId: `collaboration:stream-start:${initial.id}`, commandType: 'RunCollaboration', actor: envelope.actor, scope: envelope.scope, occurredAt: this.deps.now() },
      () => this.uow.execute({ policy: { kind: 'normal' }, collaboration: { expectedRevision: initial.revision, next: claimed }, apply: workspace => ({ next: workspace, value: { executionId, collaboration: claimed } }) }));
    if (claim.value.executionId !== executionId) throw conflict('COLLABORATION_ALREADY_STARTED');
    const publish = async () => {
      const record = await this.record(initial.id);
      await options?.onRuntimeEvent?.({ type: 'COLLABORATION_STATE', collaborationId: record.id, revision: record.revision, status: record.status, budget: record.budget,
        attempts: record.attempts.map(({ input: _input, text: _text, ...attempt }) => attempt) } as { type: string });
      return record;
    };
    const childOptions = (participantId: string, round: number): CommandExecutionOptions => ({ signal: options?.signal,
      onRuntimeEvent: event => options?.onRuntimeEvent?.({ ...event, collaborationId: initial.id, participantId, round } as { type: string }) });
    const budgetCodes = ['COLLABORATION_TIME_BUDGET','COLLABORATION_TOKEN_BUDGET','COLLABORATION_SYNTHESIS_BUDGET'];
    const codeOf = (error: unknown) => (error as { code?: string; details?: { code?: string } }).details?.code ?? (error as { code?: string }).code;
    let terminal: CollaborationRecord['status'] | undefined;
    try {
      await options?.onReady?.(); await publish();
      // Sequential dispatch keeps reservations bounded and deterministic; independent first-round inputs still share the same base.
      rounds: for (let round = 1; round <= initial.budget.maxRounds; round++) {
        for (const participantId of initial.participants) {
          if (options?.signal?.aborted) throw conflict('GENERATION_STOPPED');
          const record = await this.record(initial.id);
          if (record.cancelRequestedAt || record.status === 'budget-exhausted') break rounds;
          try {
            await this.child(envelope, `${initial.id}:${round}:${participantId}`, 'InvokeCollaboration', { collaborationId: initial.id, participantId, round },
              child => this.invoke(child, childOptions(participantId, round)));
          } catch (error) {
            if (options?.signal?.aborted) throw error;
            const record = await this.record(initial.id);
            if (record.cancelRequestedAt) break rounds;
            if (budgetCodes.includes(codeOf(error) ?? '')) { terminal = 'budget-exhausted'; break rounds; }
            const attempt = record.attempts.filter(attempt => attempt.participantId === participantId && attempt.round === round).at(-1);
            const run = attempt ? await this.uow.getRun?.(attempt.runRef) : undefined;
            if (!attempt || attempt.status === 'running' || !run || ['storage','commit'].includes(run.error?.class ?? '')) throw error;
            // Provider failures are evidence for the next round and synthesis; retry remains an explicit operation.
          }
          await publish();
        }
      }
      const record = await this.record(initial.id);
      if (!record.cancelRequestedAt && record.status !== 'budget-exhausted' && !options?.signal?.aborted) {
        try {
          await this.child(envelope, `${initial.id}:synthesis`, 'SynthesizeCollaboration', { collaborationId: initial.id },
            child => this.synthesize(child, childOptions('@synthesis', 1)));
          terminal = undefined;
        } catch (error) {
          if (options?.signal?.aborted) throw error;
          const code = codeOf(error);
          if (budgetCodes.includes(code ?? '')) terminal = 'budget-exhausted';
          else if (code === 'COLLABORATION_SYNTHESIS_NO_EVIDENCE') terminal ??= 'failed';
          else {
            const latest = await this.record(initial.id);
            const attempt = latest.attempts.filter(attempt => attempt.participantId === '@synthesis').at(-1);
            if (!attempt || attempt.status === 'running') throw error;
            terminal = 'interrupted';
          }
        }
      }
      const current = await this.record(initial.id);
      const settleCurrent = (record: CollaborationRecord) => {
        const next = structuredClone(record); next.revision += 1;
        if (terminal && !record.cancelRequestedAt && !['completed','partial'].includes(record.status)) next.status = terminal;
        return next;
      };
      const mutation = { expectedRevision: current.revision, next: settleCurrent(current), settleCurrent };
      const result = await this.uow.execute({ policy: { kind: 'normal' }, collaboration: mutation, apply: workspace => ({ next: workspace, value: { collaboration: mutation.next } }) });
      await publish();
      return result.value;
    } finally {
      if (options?.signal?.aborted) await this.child(envelope, `${initial.id}:disconnect`, 'StopCollaboration', { collaborationId: initial.id }, child => this.stop(child));
    }
  }

  async create(envelope: CommandEnvelope<'CreateCollaboration'>) {
    const previous = await this.uow.readCommittedResult?.<CommandMap['CreateCollaboration']['result']>();
    if (previous?.found) return previous.value;
    if (!this.uow.tracksRuns || !this.uow.getCollaboration) throw conflict('COLLABORATION_PERSISTENCE_UNAVAILABLE');
    const payload = envelope.payload;
    if (!payload || typeof payload !== 'object' || typeof payload.prompt !== 'string' || !payload.prompt.trim() || payload.prompt.length > 32_000
      || !Array.isArray(payload.modelIds) || payload.modelIds.length < 2 || payload.modelIds.length > 4
      || (payload.tokenLimit !== undefined && payload.tokenLimit > 32_000) || (payload.timeLimitMs !== undefined && payload.timeLimitMs > 180_000)) throw conflict('INVALID_COLLABORATION_CONFIG');
    const models = await this.deps.runtime.listModels();
    const snapshots = [...new Set([...payload.modelIds, payload.synthesisModelId])].map(id => models.find(model => model.id === id));
    if (snapshots.some(model => !model)) throw conflict('COLLABORATION_MODEL_UNAVAILABLE');
    const prepared = await this.deps.prepare({ prompt: payload.prompt, operation: 'send', attachmentIds: payload.attachmentIds ?? [], generation: { temperature: 0.2, topP: 1, maxTokens: 1024 } });
    const base = { workspaceId: envelope.workspaceId, nodeId: prepared.request.nodeId, contextBaseHash: '', prompt: payload.prompt, history: prepared.request.history,
      contextItems: prepared.request.contextItems, attachmentIds: prepared.manifest.attachmentIds, attachments: prepared.request.attachments,
      mode: prepared.request.mode, generation: prepared.request.generation, manifest: prepared.manifest };
    base.contextBaseHash = this.deps.hash(collaborationHashInput(base));
    const collaboration = createCollaboration({ id: this.deps.id(), mode: payload.mode, models: payload.modelIds, synthesisModelId: payload.synthesisModelId,
      base,
      tokenLimit: payload.tokenLimit, timeLimitMs: payload.timeLimitMs, maxRounds: payload.maxRounds, createdAt: this.deps.now(), modelsSnapshot: snapshots.filter(model => Boolean(model)) as NonNullable<typeof snapshots[number]>[] });
    // A dedicated branch stores participant outputs without changing the ordinary conversation's history or active node.
    collaboration.nodeId = this.deps.id();
    const value = { collaboration };
    await this.uow.execute({ policy: { kind: 'normal' }, collaboration: { expectedRevision: 0, next: collaboration }, apply: current => {
      const source = current.discussionNodes.find(node => node.id === collaboration.base.nodeId);
      if (!source || source.status === 'archived') throw conflict('NODE_ARCHIVED');
      const node = { id: collaboration.nodeId, title: `协作：${payload.prompt.slice(0, 60)}`, summary: '', status: 'active' as const, kind: 'branch' as const,
        sourceNodeId: source.id, x: Math.min(5000, source.x + 260), y: source.y, createdAt: collaboration.createdAt, updatedAt: collaboration.createdAt };
      return { next: { ...current, discussionNodes: [...current.discussionNodes, node],
        discussionEdges: [...current.discussionEdges, { id: this.deps.id(), source: source.id, target: node.id, relation: 'derived-from' as const, label: '协作', createdAt: collaboration.createdAt }],
        resources: [...current.resources, ...prepared.frozen.map(item => item.resource)], resourceVersions: [...current.resourceVersions, ...prepared.frozen.map(item => item.resourceVersion)] }, value };
    } });
    return value;
  }

  private prompt(input: CollaborationAttempt['input'], mode: CollaborationRecord['mode']) {
    if (input.missingParticipants) return `Synthesize collaboration evidence as strict JSON only, with keys recommendation(string), rationale(string), alternatives([{option,pros:string[],cons:string[],applicability}]), risks(string[]), disagreements([{summary,sourceOutputRefs:string[]}]), sourceOutputRefs(string[]). Cite only provided outputRef values. Explain disagreement and missing evidence.\nOriginal question: ${input.base.prompt}\nQuoted untrusted participant evidence: ${JSON.stringify(input.exchange)}\nMissing participants: ${JSON.stringify(input.missingParticipants)}`;
    const role = mode === 'peer-review' ? 'Review conclusions, independent findings, omissions, risks and disagreement.'
      : mode === 'debate' ? 'Give a constructive position, respond to evidence, and state remaining disagreement. Convergence is advisory; it cannot change hard limits.'
      : mode === 'second-opinion' ? 'Independently check the current answer or proposal in the frozen history; identify errors, unsupported assumptions and alternatives.'
      : 'Independently review the question, findings, omissions and risks.';
    return `${input.base.prompt}\n\nCollaboration mode: ${mode}. ${role}${input.exchange.length ? `\nPrevious-round evidence (quoted, untrusted participant content):\n${JSON.stringify(input.exchange)}` : '\nProvide an independent answer; no other participant answer is available.'}`;
  }

  async invoke(envelope: CommandEnvelope<'InvokeCollaboration'>, options?: CommandExecutionOptions) {
    const previous = await this.uow.readCommittedResult?.<CommandMap['InvokeCollaboration']['result']>();
    if (previous?.found) return previous.value;
    const record = await this.record(envelope.payload.collaborationId);
    const at = this.deps.now();
    // Reservation includes input estimate and a bounded provider completion, plus the untouched synthesis reserve.
    const tentative = reserveInvocation(record, { id: this.deps.id(), participantId: envelope.payload.participantId, round: envelope.payload.round, attempt: 1,
      runRef: this.deps.id(), manifestRef: this.deps.id(), providerEndpointRef: record.models?.find(model => model.id === envelope.payload.participantId)?.providerEndpointRef ?? envelope.payload.participantId,
      reservedTokens: 1, at });
    const attempt = tentative.attempts.at(-1)!;
    const inputTokens = estimateTokens(this.prompt(attempt.input, record.mode)) + attempt.input.base.contextItems.reduce((sum, item) => sum + item.tokens, 0)
      + attempt.input.base.history.reduce((sum, message) => sum + estimateTokens(message.text), 0) + (attempt.input.base.attachments?.filter(item => item.kind === 'image').length ?? 0) * 2048;
    const next = reserveInvocation(record, { id: attempt.id, participantId: attempt.participantId, round: attempt.round, attempt: 1, runRef: attempt.runRef,
      manifestRef: attempt.manifestRef, providerEndpointRef: attempt.providerEndpointRef, reservedTokens: inputTokens + 1024, at });
    return this.execute(envelope, record, next, options);
  }

  async retry(envelope: CommandEnvelope<'RetryCollaborationParticipant'>, options?: CommandExecutionOptions) {
    const previous = await this.uow.readCommittedResult?.<CommandMap['InvokeCollaboration']['result']>();
    if (previous?.found) return previous.value;
    const record = await this.record(envelope.payload.collaborationId);
    const next = retryInvocation(record, envelope.payload.attemptId, { id: this.deps.id(), runRef: this.deps.id(), manifestRef: this.deps.id(), at: this.deps.now() });
    return this.execute(envelope, record, next, options, record.attempts.find(attempt => attempt.id === envelope.payload.attemptId)!.runRef);
  }

  async synthesize(envelope: CommandEnvelope<'SynthesizeCollaboration'>, options?: CommandExecutionOptions) {
    const previous = await this.uow.readCommittedResult?.<CommandMap['InvokeCollaboration']['result']>();
    if (previous?.found) return previous.value;
    const record = await this.record(envelope.payload.collaborationId);
    const model = record.models?.find(model => model.id === record.synthesisModelId);
    if (!model) throw conflict('COLLABORATION_MODEL_UNAVAILABLE');
    const next = reserveSynthesis(record, { id: this.deps.id(), runRef: this.deps.id(), manifestRef: this.deps.id(), providerEndpointRef: model.providerEndpointRef ?? model.id, at: this.deps.now() });
    const attempt = next.attempts.at(-1)!;
    const inputTokens = estimateTokens(this.prompt(attempt.input, record.mode)) + record.base.contextItems.reduce((sum, item) => sum + item.tokens, 0) + record.base.history.reduce((sum, message) => sum + estimateTokens(message.text), 0);
    if (inputTokens + 1024 > attempt.reservedTokens) throw conflict('COLLABORATION_SYNTHESIS_BUDGET');
    return this.execute(envelope, record, next, options);
  }

  private async execute(envelope: CommandEnvelope<'InvokeCollaboration' | 'RetryCollaborationParticipant' | 'SynthesizeCollaboration'>, before: CollaborationRecord, reserved: CollaborationRecord, options?: CommandExecutionOptions, parentRunRef?: string) {
    const attempt = reserved.attempts.at(-1)!;
    const model = reserved.models?.find(model => model.id === (attempt.participantId === '@synthesis' ? reserved.synthesisModelId : attempt.participantId));
    const template = reserved.base.manifest;
    if (!model || !template) throw conflict('COLLABORATION_FROZEN_INPUT_MISSING');
    const versions = await this.uow.read(workspace => {
      if (workspace.discussionNodes.find(node => node.id === reserved.nodeId)?.status === 'archived') throw conflict('NODE_ARCHIVED');
      if (workspace.discussionNodes.find(node => node.id === reserved.nodeId)?.status === 'resolved') throw conflict('COLLABORATION_ALREADY_RETAINED');
      return workspace.resourceVersions;
    });
    const refs = [...template.contextItems.map(item => ({ id: item.resourceVersionId, digest: item.digest })), ...(attempt.input.base.attachments ?? []).map(item => ({ id: item.resourceVersionId, digest: item.digest }))];
    for (const ref of refs) {
      const version = versions.find(version => version.id === ref.id);
      if (!version || version.purgedAt || !ref.digest || version.digest !== ref.digest) throw conflict('COLLABORATION_MISSING_RESOURCE');
      await this.deps.blobs.read(version.blobRef, version.digest);
    }
    const createdAt = this.deps.now();
    const prepared: PreparedRun = { frozen: [], createdAt, userMessageId: this.deps.id(), versionGroupId: this.deps.id(), version: 1,
      manifest: { ...structuredClone(template), id: attempt.manifestRef, nodeId: reserved.nodeId, requestId: attempt.runRef, createdAt, model: model.model, provider: model.provider },
      request: { requestId: attempt.runRef, manifestId: attempt.manifestRef, projectId: reserved.workspaceId, nodeId: reserved.nodeId,
        modelId: model.id, modelSnapshot: structuredClone(model), prompt: this.prompt(attempt.input, reserved.mode), history: structuredClone(attempt.input.base.history),
        contextItems: structuredClone(attempt.input.base.contextItems), mode: attempt.input.base.mode ?? 'Strict',
        attachments: attempt.input.base.attachments?.map(attachment => ({ ...structuredClone(attachment), blobRef: versions.find(version => version.id === attachment.resourceVersionId)!.blobRef })), generation: attempt.input.base.generation } };
    try {
      const result = await this.deps.runs.execute(envelope, prepared.request, this.deps.inputFor(prepared.request), async (completion, mutation) => {
        const current = await this.record(reserved.id); const outputId = this.deps.id();
        const summary = attempt.participantId === '@synthesis' ? parseCollaborationSynthesis(completion.text, attempt.input.exchange.flatMap(item => item.outputRef ? [item.outputRef] : []), attempt.input.missingParticipants ?? []) : undefined;
        const settledAt = this.deps.now();
        const settleCurrent = (record: CollaborationRecord) => {
          const next = settleInvocation(record, attempt.id, { status: 'completed', outputRef: outputId, text: completion.text, usedTokens: completion.usage?.estimated ? undefined : completion.usage?.totalTokens, at: settledAt });
          if (summary) { next.synthesis = summary; if (next.status !== 'budget-exhausted') next.status = summary.missingParticipants.length ? 'partial' : 'completed'; }
          return next;
        };
        const result = await this.deps.commit(prepared, completion, mutation, { expectedRevision: current.revision, next: settleCurrent(current), settleCurrent }, outputId);
        return result;
      }, options, parentRunRef, [], { creation: { expectedRevision: before.revision, next: reserved }, timeoutMs: Math.max(1, Date.parse(reserved.budget.deadlineAt) - Date.parse(createdAt)) });
      return { collaboration: await this.record(reserved.id), result };
    } catch (error) {
      const current = await this.record(reserved.id);
      if (current.attempts.find(item => item.id === attempt.id)?.status === 'running') {
        const run = await this.uow.getRun?.(attempt.runRef);
        const settledAt = this.deps.now();
        const settleCurrent = (record: CollaborationRecord) => {
          if (record.attempts.find(item => item.id === attempt.id)?.status !== 'running') return record;
          const next = settleInvocation(record, attempt.id, { status: run?.status === 'canceled' ? 'canceled' : run?.status === 'interrupted' ? 'interrupted' : 'failed', errorCode: run?.error?.code ?? 'RUNTIME_ERROR', usedTokens: run?.telemetry.usage?.estimated ? undefined : run?.telemetry.usage?.totalTokens, at: settledAt });
          if (attempt.participantId === '@synthesis' && next.status !== 'budget-exhausted') next.status = 'interrupted';
          return next;
        };
        const next = settleCurrent(current);
        await this.uow.withCommand!({ commandId: `collaboration:settle:${attempt.id}`, commandType: 'SettleCollaboration', actor: envelope.actor, scope: envelope.scope, occurredAt: this.deps.now() }, async () => {
          await this.uow.execute({ policy: { kind: 'normal' }, collaboration: { expectedRevision: current.revision, next, settleCurrent }, apply: workspace => ({ next: workspace, value: { collaborationId: next.id } }) });
        });
      }
      throw error;
    }
  }

  async stop(envelope: CommandEnvelope<'StopCollaboration'>) {
    const previous = await this.uow.readCommittedResult?.<CommandMap['StopCollaboration']['result']>();
    if (previous?.found) { await this.cancelRuns(previous.value.collaboration, envelope); return previous.value; }
    const record = await this.record(envelope.payload.collaborationId);
    const at = this.deps.now();
    const mutation = { expectedRevision: record.revision, next: stopCollaboration(record, at), settleCurrent: (record: CollaborationRecord) => stopCollaboration(record, at) };
    // Persist stop first. Run transitions also check this fact, covering the controller-registration race.
    const committed = await this.uow.execute({ policy: { kind: 'normal' }, collaboration: mutation, apply: workspace => ({ next: workspace, value: { collaboration: mutation.next } }) });
    const next = committed.value.collaboration;
    await this.cancelRuns(next, envelope);
    return { collaboration: next };
  }

  private async cancelRuns(record: CollaborationRecord, envelope: CommandEnvelope<'StopCollaboration'>) {
    for (const attempt of record.attempts) {
      const run = await this.uow.getRun?.(attempt.runRef);
      if (!run || !['created','dispatching','running'].includes(run.status)) continue;
      const commandId = `collaboration:stop:${record.id}:${attempt.id}`;
      await this.uow.withCommand!({ commandId, commandType: 'CancelExecutionRun', actor: envelope.actor, scope: envelope.scope, occurredAt: this.deps.now() },
        () => this.deps.runs.cancel({ ...envelope, commandId, commandType: 'CancelExecutionRun', payload: { runId: attempt.runRef } }, attempt.runRef));
    }
  }
}
