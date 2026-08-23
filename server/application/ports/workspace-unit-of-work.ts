import type { WorkspaceData } from '../../domain';

export type WorkspaceMutationPolicy =
  | { kind: 'normal' }
  | { kind: 'purge'; nodeId: string; auditReceiptId: string };

/** A policy-bound workspace mutation. The policy is known before persistence begins. */
export interface WorkspaceMutation<T> {
  policy: WorkspaceMutationPolicy;
  apply(workspace: WorkspaceData): { next: WorkspaceData; value: T } | Promise<{ next: WorkspaceData; value: T }>;
}

/**
 * Application-facing transaction boundary. Implementations own persistence and
 * enforce history rules; commands supply the next aggregate and explicit policy.
 */
export interface WorkspaceUnitOfWork {
  read<T>(reader: (workspace: Readonly<WorkspaceData>) => T | Promise<T>): Promise<T>;
  execute<T>(mutation: WorkspaceMutation<T>): Promise<T>;
}
