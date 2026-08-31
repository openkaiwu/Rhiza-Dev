import type { WorkspaceExecutionResult, WorkspaceMutation, WorkspaceMutationPolicy, WorkspaceUnitOfWork } from '../application/ports/workspace-unit-of-work';
import type { WorkspaceRepository, WorkspaceUpdateOptions } from '../store';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createSeedWorkspace } from '../seed';
import type { WorkspaceData } from '../domain';
import type { RunMutation } from '../application/ports/workspace-unit-of-work';
import type { CommandFactContext } from '../domain-journal';
import { eventForCommand, toActivityItem } from '../domain-journal';

function updateOptions(policy: WorkspaceMutationPolicy | undefined): WorkspaceUpdateOptions | undefined {
  if (!policy || policy.kind === 'normal') return undefined;
  return { purge: { nodeId: policy.nodeId, auditReceiptId: policy.auditReceiptId } };
}

/** Bridges the M01 repository while preserving its append-only/purge guarantees. */
export class RepositoryWorkspaceUnitOfWork implements WorkspaceUnitOfWork {
  private readonly scope = new AsyncLocalStorage<string>();
  private readonly command = new AsyncLocalStorage<CommandFactContext>();
  constructor(private readonly repository: WorkspaceRepository) {}

  get tracksRuns() { return Boolean(this.repository.getRun); }
  private runRepository() {
    const workspaceId = this.scope.getStore();
    return workspaceId ? this.repository.forWorkspace?.(workspaceId) ?? this.repository : this.repository;
  }
  async listRuns(limit = 50) { return this.runRepository().listRuns?.(limit) ?? []; }
  async getRun(runId: string) { return this.runRepository().getRun?.(runId); }
  async writeRunTraces(runId: string, attempt: number, traces: import('../application/ports/workspace-unit-of-work').RunTrace[]) { await this.runRepository().writeRunTraces?.(runId, attempt, traces); }

  async withWorkspace<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
    return this.scope.run(workspaceId, operation);
  }

  async withCommand<T>(context: CommandFactContext, operation: () => Promise<T>): Promise<T> {
    return this.command.run(context, operation);
  }

  async ensureWorkspaceInitialized(workspaceId: string, name: string): Promise<WorkspaceData> {
    const seed = createSeedWorkspace();
    const created = { ...seed, projectId: workspaceId, projectTitle: name, updatedAt: new Date().toISOString() };
    const target = this.repository.forWorkspace?.(workspaceId);
    if (!target) throw Object.assign(new Error('Scoped workspace persistence is unavailable'), { code: 'WORKSPACE_PERSISTENCE_UNAVAILABLE', status: 503 });
    if (!target.initialize) throw Object.assign(new Error('Scoped workspace initialization is unavailable'), { code: 'WORKSPACE_PERSISTENCE_UNAVAILABLE', status: 503 });
    return target.initialize(created);
  }

  private async selected(): Promise<WorkspaceData> {
    const workspaceId = this.scope.getStore();
    const defaultWorkspaceId = this.repository.defaultWorkspaceId ?? '00000000-0000-4000-8000-000000000001';
    if (!workspaceId || workspaceId === defaultWorkspaceId) return this.repository.read();
    const target = this.repository.forWorkspace?.(workspaceId);
    if (!target) throw Object.assign(new Error('Scoped workspace persistence is unavailable'), { code: 'WORKSPACE_PERSISTENCE_UNAVAILABLE', status: 503 });
    return target.read();
  }

  async read<T>(reader: (workspace: Readonly<import('../domain').WorkspaceData>) => T | Promise<T>): Promise<T> {
    return reader(await this.selected());
  }

  async execute<T>(mutation: WorkspaceMutation<T>): Promise<WorkspaceExecutionResult<T>> {
    let value!: T;
    const workspaceId = this.scope.getStore();
    const defaultWorkspaceId = this.repository.defaultWorkspaceId ?? '00000000-0000-4000-8000-000000000001';
    const target = workspaceId && workspaceId !== defaultWorkspaceId ? this.repository.forWorkspace?.(workspaceId) : this.repository;
    if (!target) throw Object.assign(new Error('Scoped workspace persistence is unavailable'), { code: 'WORKSPACE_PERSISTENCE_UNAVAILABLE', status: 503 });
    const context = this.command.getStore();
    if (context && target.executeCommand) {
      const result = await target.executeCommand({
        context,
        options: { ...updateOptions(mutation.policy), run: mutation.run },
        apply: async current => mutation.apply(current),
        events: (previous, next, commandValue) => mutation.run ? runEvents(mutation.run, context, previous, next, commandValue) : eventForCommand(context, previous, next, commandValue),
      });
      return { workspace: result.workspace, value: result.value };
    }
    const workspace = await target.update(async current => {
      const result = await mutation.apply(current);
      value = result.value;
      return result.next;
    }, updateOptions(mutation.policy));
    return { workspace, value };
  }

  async readActivity(limit = 50) {
    const workspaceId = this.scope.getStore();
    const defaultWorkspaceId = this.repository.defaultWorkspaceId ?? '00000000-0000-4000-8000-000000000001';
    const target = workspaceId && workspaceId !== defaultWorkspaceId ? this.repository.forWorkspace?.(workspaceId) : this.repository;
    if (!target?.readJournal) return [];
    return (await target.readJournal(limit)).map(toActivityItem);
  }

  async readCommittedResult<T>(): Promise<{ found: false } | { found: true; value: T }> {
    const context = this.command.getStore();
    if (!context) return { found: false };
    const workspaceId = this.scope.getStore();
    const defaultWorkspaceId = this.repository.defaultWorkspaceId ?? '00000000-0000-4000-8000-000000000001';
    const target = workspaceId && workspaceId !== defaultWorkspaceId ? this.repository.forWorkspace?.(workspaceId) : this.repository;
    const receipt = await target?.readCommandReceipt?.(context.commandId);
    if (receipt && receipt.commandType !== context.commandType) throw Object.assign(new Error('Command id 已被其他命令使用。'), { code: 'COMMAND_ID_CONFLICT', status: 409 });
    if (receipt?.status === 'rejected') throw Object.assign(new Error(receipt.error!.message), receipt.error);
    if (!receipt || receipt.status !== 'committed') return { found: false };
    return { found: true, value: receipt.result as T };
  }

  async executeWorkspaceLifecycle(context: CommandFactContext, command: import('../application/ports/workspace-unit-of-work').WorkspaceLifecycleCommand) {
    return this.repository.executeWorkspaceLifecycle?.(context, command);
  }
}

function runEvents(run: RunMutation, context: CommandFactContext, previous: import('../domain').WorkspaceData, next: import('../domain').WorkspaceData, value: unknown): import('../domain-journal').DomainEventDraft[] {
  return [
    ...(context.commandType === 'CreateConversationRun' ? eventForCommand(context, previous, next, value) : []),
    { eventType: run.kind === 'create' ? 'run.created' : 'run.status.changed', aggregateType: 'run', aggregateId: run.kind === 'create' ? run.run.id : run.runId, payload: { status: run.kind === 'create' ? 'created' : run.patch.status } },
  ];
}
