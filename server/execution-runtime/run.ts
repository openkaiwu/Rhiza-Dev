import type { RuntimeEvent, RuntimeRequest } from './runtime';
import type { TokenUsage } from '../domain';

export type RunStatus = 'created' | 'dispatching' | 'running' | 'completed' | 'failed' | 'canceled' | 'interrupted';
export const activeRunStatuses: RunStatus[] = ['created', 'dispatching', 'running'];
export interface ContextEnvelope {
  schemaVersion: '1.0.0';
  replay?: { classification: 'exact' | 'partial' | 'current-model'; sourceRunRef: string; sourceManifestRef: string };
  request: Omit<RuntimeRequest, 'signal'>;
  executor: { runtime: string; modelSpecRef: string; providerEndpointRef: string; model: string; provider: string };
}
export interface ExecutionRun {
  id: string;
  workspaceId: string;
  nodeId: string;
  commandId: string;
  status: RunStatus;
  attempt: number;
  parentRunRef?: string;
  input: ContextEnvelope;
  inputHash: string;
  /** Original input digest retained when a portable snapshot removes endpoint locations. */
  originInputHash?: string;
  createdAt: string;
  dispatchingAt?: string;
  runningAt?: string;
  terminalAt?: string;
  cancelRequestedAt?: string;
  error?: { code: string; class: 'canceled' | 'timeout' | 'provider' | 'network' | 'interrupted' | 'commit'; message: string };
  telemetry: { durationMs?: number; ttftMs?: number; usage?: TokenUsage; traceCount: number };
}
export const RUN_ERROR_CODES = [
  'GENERATION_STOPPED', 'INCOMPLETE_RUNTIME_STREAM', 'INVALID_PROVIDER_RESPONSE', 'LEGACY_RUN_ERROR_REDACTED',
  'MODEL_NOT_FOUND', 'MODEL_NOT_SELECTED', 'PROCESS_INTERRUPTED', 'PROVIDER_CONFIGURATION_CHANGED',
  'PROVIDER_ERROR', 'PROVIDER_NOT_CONFIGURED', 'PROVIDER_NOT_FOUND', 'PROVIDER_REQUEST_FAILED',
  'PROVIDER_TIMEOUT', 'PROVIDER_UNREACHABLE', 'RUN_COMMIT_FAILED', 'RUNTIME_ERROR',
  'UPSTREAM_STREAM_FAILED', 'UPSTREAM_TIMEOUT',
] as const;
export const RUN_ERROR_CLASSES = ['canceled', 'timeout', 'provider', 'network', 'interrupted', 'commit'] as const;
export const RUN_ERROR_MESSAGES = [
  '用户已停止生成。', '生成已停止。', '执行未完成，请查看错误类别并重试。',
  '服务重启，无法确认外部执行完成；请手动重试。', '历史执行错误详情已清理。',
  'Historical execution failure',
] as const;
export function safeRunErrorCode(code: unknown): string {
  return typeof code === 'string' && RUN_ERROR_CODES.some(known => known === code) ? code : 'RUNTIME_ERROR';
}
export function safeRunErrorClass(value: unknown): NonNullable<ExecutionRun['error']>['class'] {
  return typeof value === 'string' && RUN_ERROR_CLASSES.some(known => known === value)
    ? value as NonNullable<ExecutionRun['error']>['class'] : 'commit';
}
export function redactedLegacyRunError(value: unknown): NonNullable<ExecutionRun['error']> {
  const error = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    code: typeof error.code === 'string' && RUN_ERROR_CODES.some(known => known === error.code) ? error.code : 'LEGACY_RUN_ERROR_REDACTED',
    class: safeRunErrorClass(error.class),
    message: '历史执行错误详情已清理。',
  };
}
export type RunMutation = { kind: 'create'; run: ExecutionRun } | {
  kind: 'transition'; runId: string; attempt: number; from: RunStatus[];
  patch: Pick<ExecutionRun, 'status'> & Partial<Pick<ExecutionRun, 'dispatchingAt' | 'runningAt' | 'terminalAt' | 'cancelRequestedAt' | 'error' | 'telemetry'>>;
};
export interface RunTrace { sequence: number; type: string; at: string }
export const RUN_TRACE_TYPES = ['RUN_START', 'CONTENT_DELTA', 'REASONING_DELTA', 'TOOL_CALL_DELTA', 'USAGE', 'RUN_END', 'RUN_ERROR'] as const satisfies readonly RuntimeEvent['type'][];
const traceTypes = new Set<string>(RUN_TRACE_TYPES);
export function projectRunTrace({ sequence, type, at }: RunTrace): RunTrace {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('RUN_TRACE_SEQUENCE_INVALID');
  if (!traceTypes.has(type)) throw new Error('RUN_TRACE_TYPE_INVALID');
  const timestamp = Date.parse(at);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== at) throw new Error('RUN_TRACE_TIMESTAMP_INVALID');
  return { sequence, type, at };
}

/** Content stays in the transport. Only bounded metadata is retained here. */
export class RunTraceBuffer {
  private pending: RunTrace[] = [];
  count = 0;
  constructor(private readonly write: (batch: RunTrace[]) => Promise<void>) {}
  async push(type: string, at: string) {
    const trace = projectRunTrace({ sequence: this.count + 1, type, at });
    this.count = trace.sequence;
    this.pending.push(trace);
    if (this.pending.length >= 128) await this.flush();
  }
  async flush() {
    if (!this.pending.length) return;
    await this.write(this.pending);
    this.pending = [];
  }
}

/** Volatile bounded event window; transport delivery applies backpressure. Never journaled. */
export class TransientStreamSink<T> {
  readonly recent: T[] = [];
  constructor(private readonly deliver: (event: T) => void | Promise<void>) {}
  async publish(event: T) {
    this.recent.push(event);
    if (this.recent.length > 256) this.recent.shift();
    await this.deliver(event);
  }
}
