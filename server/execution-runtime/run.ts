import type { RuntimeRequest } from './runtime';
import type { TokenUsage } from '../domain';

export type RunStatus = 'created' | 'dispatching' | 'running' | 'completed' | 'failed' | 'canceled' | 'interrupted';
export const activeRunStatuses: RunStatus[] = ['created', 'dispatching', 'running'];
export interface ContextEnvelope {
  schemaVersion: '1.0.0';
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
  createdAt: string;
  dispatchingAt?: string;
  runningAt?: string;
  terminalAt?: string;
  cancelRequestedAt?: string;
  error?: { code: string; class: 'canceled' | 'timeout' | 'provider' | 'network' | 'interrupted' | 'commit'; message: string };
  telemetry: { durationMs?: number; ttftMs?: number; usage?: TokenUsage; traceCount: number };
}
export type RunMutation = { kind: 'create'; run: ExecutionRun } | {
  kind: 'transition'; runId: string; attempt: number; from: RunStatus[];
  patch: Pick<ExecutionRun, 'status'> & Partial<Pick<ExecutionRun, 'dispatchingAt' | 'runningAt' | 'terminalAt' | 'cancelRequestedAt' | 'error' | 'telemetry'>>;
};
export interface RunTrace { sequence: number; type: string; at: string }

/** Content stays in the transport. Only bounded metadata is retained here. */
export class RunTraceBuffer {
  private pending: RunTrace[] = [];
  count = 0;
  constructor(private readonly write: (batch: RunTrace[]) => Promise<void>) {}
  async push(type: string, at: string) {
    const trace = { sequence: ++this.count, type, at };
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
