export type { ExecutionRun, RunMutation, RunTrace } from '../../execution-runtime/run';
import type { WorkspaceData } from '../../domain';
import type { CommandFactContext, WorkspaceActivityItem } from '../../domain-journal';
import type { WorkspaceRecord } from '../../contracts/application';
import type { GraphChangesInput, GraphChangesResult, GraphNeighborhoodInput, GraphPathInput, GraphQueryResult, GraphTreeInput, WorkspaceGraphProjection } from '../../contracts/graph-projection';
export type { GraphChangesInput, GraphChangesResult, GraphNeighborhoodInput, GraphPathInput, GraphQueryResult, GraphTreeInput, WorkspaceGraphProjection } from '../../contracts/graph-projection';

export type WorkspaceLifecycleCommand =
  | { kind: 'create'; workspaceId: string; name: string; createdBy: string }
  | { kind: 'rename'; workspaceId: string; name: string; expectedRevision: number }
  | { kind: 'archive' | 'restore'; workspaceId: string; expectedRevision: number };

export type WorkspaceMutationPolicy =
  | { kind: 'normal' }
  | { kind: 'purge'; nodeId: string; auditReceiptId: string };

/** A policy-bound workspace mutation. The policy is known before persistence begins. */
export interface WorkspaceMutation<T> {
  policy: WorkspaceMutationPolicy;
  run?: import('../../execution-runtime/run').RunMutation;
  apply(workspace: WorkspaceData): { next: WorkspaceData; value: T } | Promise<{ next: WorkspaceData; value: T }>;
}

export interface WorkspaceExecutionResult<T> {
  /** The committed aggregate returned by persistence, including store metadata. */
  workspace: WorkspaceData;
  value: T;
}

/**
 * Application-facing transaction boundary. Implementations own persistence and
 * enforce history rules; commands supply the next aggregate and explicit policy.
 */
export interface WorkspaceUnitOfWork {
  readonly tracksRuns?: boolean;
  listRuns?(limit?: number): Promise<import('../../execution-runtime/run').ExecutionRun[]>;
  getRun?(runId: string): Promise<import('../../execution-runtime/run').ExecutionRun | undefined>;
  writeRunTraces?(runId: string, attempt: number, traces: import('../../execution-runtime/run').RunTrace[]): Promise<void>;
  read<T>(reader: (workspace: Readonly<WorkspaceData>) => T | Promise<T>): Promise<T>;
  execute<T>(mutation: WorkspaceMutation<T>): Promise<WorkspaceExecutionResult<T>>;
  /** Binds receipt/event identity without exposing transaction steps to command handlers. */
  withCommand?<T>(context: CommandFactContext, operation: () => Promise<T>): Promise<T>;
  readActivity?(limit?: number): Promise<WorkspaceActivityItem[]>;
  readGraphProjection?(): Promise<WorkspaceGraphProjection>;
  rebuildGraphProjection?(): Promise<WorkspaceGraphProjection>;
  queryGraphNeighborhood?(input: GraphNeighborhoodInput): Promise<GraphQueryResult>;
  queryGraphPath?(input: GraphPathInput): Promise<GraphQueryResult>;
  queryGraphTree?(input: GraphTreeInput): Promise<GraphQueryResult>;
  queryGraphChanges?(input: GraphChangesInput): Promise<GraphChangesResult>;
  readCommittedResult?<T>(): Promise<{ found: false } | { found: true; value: T }>;
  executeWorkspaceLifecycle?(context: CommandFactContext, command: WorkspaceLifecycleCommand): Promise<WorkspaceRecord | undefined>;
  /** Runs a complete application request against one workspace; implementations must not leak that selection. */
  withWorkspace?<T>(workspaceId: string, operation: () => Promise<T>): Promise<T>;
  /** Idempotently completes aggregate initialization after directory creation. */
  ensureWorkspaceInitialized?(workspaceId: string, name: string): Promise<WorkspaceData>;
}
