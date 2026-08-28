import type { WorkspaceData } from '../../domain';

export type WorkspaceMutationPolicy =
  | { kind: 'normal' }
  | { kind: 'purge'; nodeId: string; auditReceiptId: string };

/** A policy-bound workspace mutation. The policy is known before persistence begins. */
export interface WorkspaceMutation<T> {
  policy: WorkspaceMutationPolicy;
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
  read<T>(reader: (workspace: Readonly<WorkspaceData>) => T | Promise<T>): Promise<T>;
  execute<T>(mutation: WorkspaceMutation<T>): Promise<WorkspaceExecutionResult<T>>;
  /** Runs a complete application request against one workspace; implementations must not leak that selection. */
  withWorkspace?<T>(workspaceId: string, operation: () => Promise<T>): Promise<T>;
  /** Idempotently completes aggregate initialization after directory creation. */
  ensureWorkspaceInitialized?(workspaceId: string, name: string): Promise<WorkspaceData>;
}
