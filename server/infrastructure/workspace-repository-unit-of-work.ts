import type { WorkspaceMutation, WorkspaceMutationPolicy, WorkspaceUnitOfWork } from '../application/ports/workspace-unit-of-work';
import type { WorkspaceRepository, WorkspaceUpdateOptions } from '../store';

function updateOptions(policy: WorkspaceMutationPolicy | undefined): WorkspaceUpdateOptions | undefined {
  if (!policy || policy.kind === 'normal') return undefined;
  return { purge: { nodeId: policy.nodeId, auditReceiptId: policy.auditReceiptId } };
}

/** Bridges the M01 repository while preserving its append-only/purge guarantees. */
export class RepositoryWorkspaceUnitOfWork implements WorkspaceUnitOfWork {
  constructor(private readonly repository: WorkspaceRepository) {}

  async read<T>(reader: (workspace: Readonly<import('../domain').WorkspaceData>) => T | Promise<T>): Promise<T> {
    return reader(await this.repository.read());
  }

  async execute<T>(mutation: WorkspaceMutation<T>): Promise<T> {
    let value!: T;
    await this.repository.update(async current => {
      const result = await mutation.apply(current);
      value = result.value;
      return result.next;
    }, updateOptions(mutation.policy));
    return value;
  }
}
