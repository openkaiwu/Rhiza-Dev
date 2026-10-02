import type { GraphChangesInput, GraphNeighborhoodInput, GraphPathInput, GraphTreeInput, WorkspaceExecutionResult, WorkspaceMutation, WorkspaceMutationPolicy, WorkspaceUnitOfWork } from '../application/ports/workspace-unit-of-work';
import type { WorkspaceRepository, WorkspaceUpdateOptions } from '../store';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createSeedWorkspace } from '../seed';
import type { WorkspaceData } from '../domain';
import type { RunMutation } from '../application/ports/workspace-unit-of-work';
import type { CommandFactContext } from '../domain-journal';
import { eventForCommand, toActivityItem } from '../domain-journal';
import { buildWorkspaceGraphProjection, graphChanges, graphNeighborhood, graphPath, graphTree } from '../graph-projection/model';
import { observeLegacyWrite } from './legacy-write-observation';

function updateOptions(policy: WorkspaceMutationPolicy | undefined): WorkspaceUpdateOptions | undefined {
  if (!policy || policy.kind === 'normal') return undefined;
  return { purge: { nodeId: policy.nodeId, auditReceiptId: policy.auditReceiptId,
    ...(policy.frozenResourceIds ? { frozenResourceIds: policy.frozenResourceIds } : {}) } };
}

/** Production mutations require command facts and transactional persistence. */
export class RepositoryWorkspaceUnitOfWork implements WorkspaceUnitOfWork {
  private readonly scope = new AsyncLocalStorage<string>();
  private readonly command = new AsyncLocalStorage<CommandFactContext>();
  constructor(private readonly repository: WorkspaceRepository, private readonly options: { fixture?: true } = {}) {}

  get tracksRuns() { return Boolean(this.repository.getRun); }
  async getCollaboration(id: string) { return this.runRepository().getCollaboration?.(id); }
  async listCollaborations(limit = 50, nodeId?: string) {
    const repository = this.runRepository();
    if (nodeId && !repository.listCollaborations) throw new Error('COLLABORATION_OWNERSHIP_UNAVAILABLE');
    return repository.listCollaborations?.(limit, nodeId) ?? [];
  }
  private runRepository() {
    const workspaceId = this.scope.getStore();
    return workspaceId ? this.repository.forWorkspace?.(workspaceId) ?? this.repository : this.repository;
  }
  async listRuns(limit = 50) { return this.runRepository().listRuns?.(limit) ?? []; }
  async readProvenance(outputId: string) { return this.runRepository().readProvenance?.(outputId); }
  async readPortableWorkspace() {
    const repository = this.runRepository();
    if (!repository.readPortableWorkspace) throw new Error('PORTABLE_WORKSPACE_UNAVAILABLE');
    return repository.readPortableWorkspace();
  }
  private backupLifecycle() {
    const lifecycle = this.runRepository().managedBackups;
    if (!lifecycle) throw Object.assign(new Error('BACKUP_UNAVAILABLE'), { code: 'BACKUP_UNAVAILABLE', status: 503 });
    return lifecycle;
  }
  private backupCommand() {
    const context = this.command.getStore();
    if (!context) throw Object.assign(new Error('COMMAND_CONTEXT_REQUIRED'), { code: 'COMMAND_CONTEXT_REQUIRED', status: 503 });
    return context;
  }
  async beginManagedBackup(retryOf?: string) { return this.backupLifecycle().begin(this.backupCommand(), retryOf); }
  async registerManagedBackup(archive: { archiveDigest: string; stateDigest: string; sizeBytes: number }) { await this.backupLifecycle().register(this.backupCommand(), archive); }
  async publishManagedBackup(retain: () => Promise<void>) { return this.backupLifecycle().publish(this.backupCommand(), retain); }
  async failManagedBackup(code: string) { return this.backupLifecycle().fail(this.backupCommand(), code); }
  async listManagedBackups(ownerId: string) { return this.backupLifecycle().list(ownerId); }
  async downloadManagedBackup(ownerId: string, backupId: string) { return this.backupLifecycle().download(ownerId, backupId); }
  async activatePortableImport(importId: string, ownerId: string, facts: import('../application/ports/portable-workspace').PortableWorkspaceFacts) {
    const repository = this.runRepository();
    if (!repository.activatePortableImport) throw new Error('PORTABLE_WORKSPACE_UNAVAILABLE');
    await repository.activatePortableImport(importId, ownerId, facts);
  }
  async prepareGraphBatch(input: import('../contracts/graph-batch').GraphBatchRequest) {
    const repository = this.runRepository(), context = this.command.getStore();
    if (!context || !repository.prepareGraphBatch) throw Object.assign(new Error('GRAPH_BATCH_UNAVAILABLE'), { code: 'GRAPH_BATCH_UNAVAILABLE', status: 503 });
    return repository.prepareGraphBatch(context, input);
  }
  async readGraphBatchPlan(actor: import('../contracts/references').ActorRef, batchId: string) {
    const repository = this.runRepository();
    if (!repository.readGraphBatchPlan) throw Object.assign(new Error('GRAPH_BATCH_UNAVAILABLE'), { code: 'GRAPH_BATCH_UNAVAILABLE', status: 503 });
    return repository.readGraphBatchPlan(actor, batchId);
  }
  async readContextHistory(input: { manifestId: string } | { messageId: string }) {
    const target = this.runRepository();
    if (target.readContextHistory) return target.readContextHistory(input);
    const workspace = await this.selected();
    const message = 'messageId' in input ? workspace.messages.find(item => item.id === input.messageId) : undefined;
    const manifestId = 'manifestId' in input ? input.manifestId : message ? message.manifestId ?? workspace.messages.find(item => item.replyToMessageId === message.id && item.manifestId)?.manifestId : undefined;
    const manifest = workspace.manifests.find(item => item.id === manifestId);
    return manifest ? { manifest, resources: workspace.resources, versions: workspace.resourceVersions } : undefined;
  }
  async readResourceVersion<T>(input: { resourceId: string; versionId: string }, reader: (facts: import('../application/ports/workspace-unit-of-work').ResourceVersionFacts) => Promise<T>): Promise<T | undefined> {
    const target = this.runRepository();
    if (target.readResourceVersion) return target.readResourceVersion(input, reader);
    if (!this.options.fixture) throw Object.assign(new Error('Resource version reads are unavailable'), { code: 'RESOURCE_VERSION_UNAVAILABLE', status: 503 });
    return this.read(async workspace => {
      const resource = workspace.resources.find(item => item.id === input.resourceId && item.workspaceId === workspace.projectId);
      const version = workspace.resourceVersions.find(item => item.id === input.versionId && item.resourceId === resource?.id);
      return resource && version ? reader({ resource, version }) : undefined;
    });
  }
  async readConversationPreparation(attachmentIds: string[], sourceMessageId?: string) {
    const target = this.runRepository();
    if (!target.readConversationPreparation) throw new Error('CONVERSATION_PREPARATION_UNAVAILABLE');
    return target.readConversationPreparation(attachmentIds, sourceMessageId);
  }
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
    if (!this.options.fixture && (!context || !target.executeCommand)) {
      const code = !context ? 'COMMAND_CONTEXT_REQUIRED' : 'TRANSACTIONAL_PERSISTENCE_REQUIRED';
      observeLegacyWrite(!context ? 'uow.missing-command' : 'uow.missing-transaction');
      throw Object.assign(new Error(code), { code, status: 503 });
    }
    if (context && target.executeCommand) {
      const result = await target.executeCommand({
        context,
        options: { ...updateOptions(mutation.policy), run: mutation.run, collaboration: mutation.collaboration },
        apply: async current => mutation.apply(current),
        events: (previous, next, commandValue) => [
          ...(mutation.run ? runEvents(mutation.run, context, previous, next, commandValue) : mutation.collaboration ? [] : eventForCommand(context, previous, next, commandValue)),
          ...(mutation.collaboration ? [{ eventType: 'collaboration.changed' as const, aggregateType: 'collaboration', aggregateId: mutation.collaboration.next.id, payload: { collaboration: mutation.collaboration.next } }] : []),
        ],
      });
      return { workspace: result.workspace, value: result.value };
    }
    observeLegacyWrite('json.fixture.update');
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

  async getRunByCommand(commandId: string) { return this.runRepository().getRunByCommand?.(commandId); }
  async searchWorkspace(query: string, limit: number) { return this.runRepository().searchWorkspace?.(query,limit) ?? []; }
  async readPersonalGraphView(actor: import('../contracts/references').ActorRef, viewType: string) {
    const target = this.runRepository();
    if (!target.readPersonalGraphView) throw Object.assign(new Error('GRAPH_VIEW_UNAVAILABLE'), { code: 'GRAPH_VIEW_UNAVAILABLE', status: 503 });
    return target.readPersonalGraphView(actor, viewType);
  }
  async savePersonalGraphView(input: import('../contracts/personal-graph-view').SavePersonalGraphView) {
    const context = this.command.getStore();
    if (!context) throw Object.assign(new Error('COMMAND_CONTEXT_REQUIRED'), { code: 'COMMAND_CONTEXT_REQUIRED', status: 503 });
    const target = this.runRepository();
    if (!target.savePersonalGraphView) throw Object.assign(new Error('TRANSACTIONAL_PERSISTENCE_REQUIRED'), { code: 'TRANSACTIONAL_PERSISTENCE_REQUIRED', status: 503 });
    return target.savePersonalGraphView(context, input);
  }
  async readGraphProjection() {
    const target = this.runRepository();
    if (target.readGraphProjection) return target.readGraphProjection();
    const workspace = await this.selected();
    const [runs, events] = await Promise.all([target.listRuns?.(10_000) ?? [], target.readJournal?.(10_000) ?? []]);
    return buildWorkspaceGraphProjection(workspace, runs, events[0]?.sequence ?? 0, events);
  }

  async rebuildGraphProjection() {
    const target = this.runRepository();
    if (target.rebuildGraphProjection) return target.rebuildGraphProjection();
    return this.readGraphProjection();
  }
  async queryGraphNeighborhood(input: GraphNeighborhoodInput) { const target = this.runRepository(); return target.queryGraphNeighborhood ? target.queryGraphNeighborhood(input) : graphNeighborhood(await this.readGraphProjection(), input); }
  async queryGraphPath(input: GraphPathInput) { const target = this.runRepository(); return target.queryGraphPath ? target.queryGraphPath(input) : graphPath(await this.readGraphProjection(), input.from, input.to, input.nodeLimit); }
  async queryGraphTree(input: GraphTreeInput) { const target = this.runRepository(); return target.queryGraphTree ? target.queryGraphTree(input) : graphTree(await this.readGraphProjection(), input.root, input.depth, input.nodeLimit); }
  async queryGraphChanges(input: GraphChangesInput) { const target = this.runRepository(); return target.queryGraphChanges ? target.queryGraphChanges(input) : graphChanges(await this.readGraphProjection(), input.cursor, input.limit); }

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
    if (!this.repository.executeWorkspaceLifecycle && !this.options.fixture) {
      observeLegacyWrite('uow.missing-transaction');
      throw Object.assign(new Error('TRANSACTIONAL_PERSISTENCE_REQUIRED'), { code: 'TRANSACTIONAL_PERSISTENCE_REQUIRED', status: 503 });
    }
    return this.repository.executeWorkspaceLifecycle?.(context, command);
  }
}

function runEvents(run: RunMutation, context: CommandFactContext, previous: import('../domain').WorkspaceData, next: import('../domain').WorkspaceData, value: unknown): import('../domain-journal').DomainEventDraft[] {
  return [
    ...(['CreateConversationRun', 'ReplayExecutionRun'].includes(context.commandType) ? eventForCommand(context, previous, next, value) : []),
    { eventType: run.kind === 'create' ? 'run.created' : 'run.status.changed', aggregateType: 'run', aggregateId: run.kind === 'create' ? run.run.id : run.runId, payload: { status: run.kind === 'create' ? 'created' : run.patch.status } },
  ];
}
