import type { CommandEnvelope, CommandExecutionOptions, CommandType } from '../contracts/application';
import { applicationError } from '../contracts/application-error';
import type { CommandFactContext } from '../domain-journal';
import { activeRunStatuses, RunTraceBuffer, TransientStreamSink, type ContextEnvelope, type ExecutionRun, type RunMutation } from '../execution-runtime/run';
import type { RuntimeEvent, RuntimePort, RuntimeRequest } from './ports/runtime';
import type { WorkspaceUnitOfWork } from './ports/workspace-unit-of-work';

type Completion = Extract<RuntimeEvent, { type: 'RUN_END' }>;
const stopped = () => applicationError('生成已停止。', 'GENERATION_STOPPED', 'conflict', 'retry', true, 499);

/** Owns local Chat execution, not external-effect scheduling or workflow leases. */
export class RunLifecycle {
  private readonly summaries = new Map<string, () => ExecutionRun['telemetry']>();
  private readonly controllers = new Map<string, AbortController>();
  constructor(private readonly uow: WorkspaceUnitOfWork, private readonly runtime: RuntimePort,
    private readonly now: () => string, private readonly id: () => string,
    private readonly hash: (input: ContextEnvelope) => string) {}

  private async change<T>(envelope: CommandEnvelope<CommandType>, mutation: RunMutation, value: T, commandId = this.id()) {
    const context: CommandFactContext = { commandId, commandType: commandId === envelope.commandId ? envelope.commandType : 'TransitionExecutionRun', actor: envelope.actor, scope: envelope.scope, occurredAt: this.now(), correlationId: envelope.correlationId, expectedRevision: mutation.kind === 'create' ? envelope.expectedRevision : undefined };
    return this.uow.withCommand!(context, async () => (await this.uow.execute({ policy: { kind: 'normal' }, run: mutation, apply: current => ({ next: current, value }) })).value);
  }

  async cancel(envelope: CommandEnvelope<CommandType>, runId: string): Promise<ExecutionRun> {
    const previous = await this.uow.readCommittedResult?.<ExecutionRun>();
    if (previous?.found) return previous.value;
    const run = await this.uow.getRun!(runId);
    if (!run) throw applicationError('执行记录不存在。', 'RUN_NOT_FOUND', 'not_found', 'none', false, 404);
    if (!activeRunStatuses.includes(run.status)) return run;
    const at = this.now();
    const patch = { status: 'canceled' as const, cancelRequestedAt: at, terminalAt: at, error: { code: 'GENERATION_STOPPED', class: 'canceled' as const, message: '用户已停止生成。' }, telemetry: this.summaries.get(runId)?.() ?? { ...run.telemetry, durationMs: Math.max(0, Date.parse(at) - Date.parse(run.createdAt)) } };
    try {
      await this.change(envelope, { kind: 'transition', runId, attempt: run.attempt, from: activeRunStatuses, patch }, { ...run, ...patch }, envelope.commandId);
    } catch (error) {
      const current = await this.uow.getRun!(runId);
      if (!current || activeRunStatuses.includes(current.status)) throw error;
    }
    this.controllers.get(runId)?.abort();
    return (await this.uow.getRun!(runId))!;
  }

  async execute<T>(envelope: CommandEnvelope<CommandType>, request: RuntimeRequest, input: ContextEnvelope,
    complete: (completion: Completion, mutation?: RunMutation) => Promise<T>, options?: CommandExecutionOptions, parentRunRef?: string): Promise<T> {
    if (!this.uow.tracksRuns) {
      request.signal = options?.signal;
      await options?.onReady?.();
      for await (const event of this.runtime.generate(request)) {
        if (event.type === 'RUN_ERROR') throw applicationError('AI Runtime 执行失败，请稍后重试。', event.code, 'infrastructure', 'retry', true, event.status);
        await options?.onRuntimeEvent?.(event);
        if (event.type === 'RUN_END') return complete(event);
      }
      throw applicationError('AI Runtime 未返回结束事件。', 'INCOMPLETE_RUNTIME_STREAM', 'infrastructure', 'retry', true, 502);
    }
    // Tx A's deterministic receipt makes concurrent same-command dispatch impossible.
    const run: ExecutionRun = { id: request.requestId, workspaceId: envelope.workspaceId, nodeId: request.nodeId,
      commandId: envelope.commandId, status: 'created', attempt: 1, parentRunRef,
      input: JSON.parse(JSON.stringify(input)) as ContextEnvelope, inputHash: this.hash(input), createdAt: this.now(), telemetry: { traceCount: 0 } };
    if (parentRunRef) {
      const parent = await this.uow.getRun!(parentRunRef);
      if (!parent || parent.nodeId !== run.nodeId) throw applicationError('重试来源不属于当前讨论。', 'INVALID_PARENT_RUN', 'validation', 'none', false, 400);
    }
    const stored = await this.change(envelope, { kind: 'create', run }, run, `run:create:${envelope.commandId}`);
    if (stored.id !== run.id) throw applicationError('该命令已有执行记录，请查询执行历史。', 'RUN_ALREADY_EXISTS', 'conflict', 'none', false, 409);
    const controller = new AbortController();
    this.controllers.set(run.id, controller);
    const stream = new TransientStreamSink<{ type: string }>(event => options?.onRuntimeEvent?.(event));
    const started = Date.now();
    const trace = new RunTraceBuffer(batch => this.uow.writeRunTraces!(run.id, run.attempt, batch));
    let ttftMs: number | undefined;
    let usage: ExecutionRun['telemetry']['usage'];
    this.summaries.set(run.id, () => ({ traceCount: trace.count, durationMs: Date.now() - started, ttftMs, usage }));
    let timeout = false;
    let committing = false;
    const timer = setTimeout(() => { timeout = true; controller.abort(); }, 120_000);
    const disconnect = () => controller.abort();
    options?.signal?.addEventListener('abort', disconnect, { once: true });
    if (options?.signal?.aborted) controller.abort();
    let rejectAbort!: (error: Error) => void;
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    // A handler is attached immediately, including cancellation before iterator creation.
    void aborted.catch(() => undefined);
    const abort = () => rejectAbort(stopped());
    controller.signal.addEventListener('abort', abort, { once: true });
    if (controller.signal.aborted) abort();
    let iterator: AsyncIterator<RuntimeEvent> | undefined;
    try {
      await options?.onReady?.();
      await Promise.race([stream.publish({ type: 'RUN_CREATED', runId: run.id } as { type: string }), aborted]);
      if (controller.signal.aborted) throw stopped();
      await this.change(envelope, { kind: 'transition', runId: run.id, attempt: 1, from: ['created'], patch: { status: 'dispatching', dispatchingAt: this.now() } }, null);
      if (controller.signal.aborted) throw stopped();
      await this.change(envelope, { kind: 'transition', runId: run.id, attempt: 1, from: ['dispatching'], patch: { status: 'running', runningAt: this.now() } }, null);
      iterator = this.runtime.generate({ ...structuredClone(run.input.request), signal: controller.signal })[Symbol.asyncIterator]();
      for (;;) {
        const next = await Promise.race([iterator.next(), aborted]);
        if (controller.signal.aborted) throw stopped();
        if (next.done) throw applicationError('执行流意外中断，未收到完成事件。', 'INCOMPLETE_RUNTIME_STREAM', 'infrastructure', 'retry', true, 502);
        const event = next.value;
        await trace.push(event.type, this.now());
        if (event.type === 'CONTENT_DELTA' && ttftMs === undefined) ttftMs = Date.now() - started;
        if (event.type === 'USAGE' || event.type === 'RUN_END') usage = event.usage ?? usage;
        if (event.type === 'RUN_ERROR') throw applicationError('AI Runtime 执行失败，请稍后重试。', event.code, 'infrastructure', 'retry', true, event.status);
        if (event.type === 'RUN_END') {
          await trace.flush();
          // Tx C guards the attempt and commits messages + terminal + facts + receipt together.
          if (controller.signal.aborted) throw stopped();
          committing = true;
          const result = await this.uow.withCommand!({ commandId: envelope.commandId, commandType: envelope.commandType, actor: envelope.actor, scope: envelope.scope, occurredAt: this.now(), correlationId: envelope.correlationId }, () => complete(event, { kind: 'transition', runId: run.id, attempt: 1, from: ['running'], patch: { status: 'completed', terminalAt: this.now(), telemetry: { traceCount: trace.count, durationMs: Date.now() - started, ttftMs, usage } } }));
          await Promise.race([stream.publish(event), aborted]);
          return result;
        }
        await Promise.race([stream.publish(event), aborted]);
      }
    } catch (error) {
      const current = await this.uow.getRun!(run.id);
      if (current && activeRunStatuses.includes(current.status)) {
        const candidate = error as { code?: string; details?: { code?: string } };
        const code = timeout ? 'PROVIDER_TIMEOUT' : controller.signal.aborted ? 'GENERATION_STOPPED' : candidate.details?.code ?? candidate.code ?? (committing ? 'RUN_COMMIT_FAILED' : 'RUNTIME_ERROR');
        const errorClass = code === 'GENERATION_STOPPED' ? 'canceled' : code.includes('TIMEOUT') ? 'timeout' : code === 'INCOMPLETE_RUNTIME_STREAM' ? 'interrupted' : code.includes('NETWORK') || code === 'PROVIDER_UNREACHABLE' ? 'network' : code.includes('PROVIDER') || code === 'MODEL_NOT_FOUND' || code === 'RUNTIME_ERROR' ? 'provider' : 'commit';
        await this.change(envelope, { kind: 'transition', runId: run.id, attempt: 1, from: activeRunStatuses,
          patch: { status: errorClass === 'canceled' ? 'canceled' : errorClass === 'interrupted' ? 'interrupted' : 'failed', terminalAt: this.now(),
            error: { code, class: errorClass, message: errorClass === 'canceled' ? '生成已停止。' : '执行未完成，请查看错误类别并重试。' }, telemetry: { traceCount: trace.count, durationMs: Date.now() - started, ttftMs, usage } } }, null);
      }
      if (timeout) throw applicationError('模型执行超时，请重试。', 'PROVIDER_TIMEOUT', 'infrastructure', 'retry', true, 504);
      throw error;
    } finally {
      clearTimeout(timer);
      controller.abort();
      controller.signal.removeEventListener('abort', abort);
      options?.signal?.removeEventListener('abort', disconnect);
      this.controllers.delete(run.id);
      this.summaries.delete(run.id);
      // Uncooperative providers must not delay a durable cancellation.
      void iterator?.return?.().catch(() => undefined);
      await trace.flush();
    }
  }
}
