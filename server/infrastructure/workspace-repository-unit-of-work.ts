import type { WorkspaceExecutionResult, WorkspaceMutation, WorkspaceMutationPolicy, WorkspaceUnitOfWork } from '../application/ports/workspace-unit-of-work';
import type { WorkspaceRepository, WorkspaceUpdateOptions } from '../store';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createSeedWorkspace } from '../seed';
import type { WorkspaceData } from '../domain';

function updateOptions(policy: WorkspaceMutationPolicy | undefined): WorkspaceUpdateOptions | undefined {
  if (!policy || policy.kind === 'normal') return undefined;
  return { purge: { nodeId: policy.nodeId, auditReceiptId: policy.auditReceiptId } };
}

/** Bridges the M01 repository while preserving its append-only/purge guarantees. */
export class RepositoryWorkspaceUnitOfWork implements WorkspaceUnitOfWork {
  private readonly scope = new AsyncLocalStorage<string>();
  private readonly additional = new Map<string, WorkspaceData>();
  constructor(private readonly repository: WorkspaceRepository) {}

  async withWorkspace<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
    return this.scope.run(workspaceId, operation);
  }

  async createWorkspace(workspaceId: string, name: string): Promise<WorkspaceData> {
    const seed = createSeedWorkspace();
    const created = { ...seed, projectId: workspaceId, projectTitle: name, updatedAt: new Date().toISOString() };
    this.additional.set(workspaceId, created);
    return created;
  }

  private async selected(): Promise<WorkspaceData> {
    const workspaceId = this.scope.getStore();
    if (!workspaceId || workspaceId === '00000000-0000-4000-8000-000000000001') return this.repository.read();
    const existing = this.additional.get(workspaceId);
    if (existing) return structuredClone(existing);
    throw Object.assign(new Error('Workspace not found'), { code: 'WORKSPACE_NOT_FOUND', status: 404 });
  }

  async read<T>(reader: (workspace: Readonly<import('../domain').WorkspaceData>) => T | Promise<T>): Promise<T> {
    return reader(await this.selected());
  }

  async execute<T>(mutation: WorkspaceMutation<T>): Promise<WorkspaceExecutionResult<T>> {
    let value!: T;
    const workspaceId = this.scope.getStore();
    if (workspaceId && workspaceId !== '00000000-0000-4000-8000-000000000001') {
      const current = await this.selected();
      const result = await mutation.apply(current);
      this.additional.set(workspaceId, structuredClone(result.next));
      return { workspace: result.next, value: result.value };
    }
    const workspace = await this.repository.update(async current => {
      const result = await mutation.apply(current);
      value = result.value;
      return result.next;
    }, updateOptions(mutation.policy));
    return { workspace, value };
  }
}
