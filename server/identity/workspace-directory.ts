import type { ActorRef, ScopeRef } from '../contracts/references';
import type { WorkspaceRecord } from '../contracts/application';
import { assertWorkspaceScope } from './workspace-scope';
import { applicationError } from '../contracts/application-error';

export interface WorkspaceDirectoryPort {
  listWorkspaces(userId: string, includeArchived?: boolean): Promise<WorkspaceRecord[]>;
  createWorkspace(record: WorkspaceRecord): Promise<{ record: WorkspaceRecord; created: boolean }>;
  updateWorkspace(record: WorkspaceRecord, expectedRevision: number): Promise<WorkspaceRecord | undefined>;
}

/** Minimal membership/scope policy; persistence is supplied by the repository adapter. */
export class WorkspaceDirectory {
  constructor(private readonly port: WorkspaceDirectoryPort) {}
  async require(actor: ActorRef, workspaceId: string, scope: ScopeRef) {
    const record = (await this.port.listWorkspaces(actor.actorId, true)).find(item => item.workspaceId === workspaceId);
    assertWorkspaceScope(actor, scope, workspaceId, Boolean(record));
    return record!;
  }
  list(actor: ActorRef, includeArchived = false) { return this.port.listWorkspaces(actor.actorId, includeArchived); }
  async create(actor: ActorRef, workspaceId: string, name: string) {
    const existing = (await this.port.listWorkspaces(actor.actorId, true)).find(item => item.workspaceId === workspaceId);
    if (existing) return { record: existing, created: false };
    const record: WorkspaceRecord = { workspaceId, name, status: 'active', createdBy: actor.actorId, revision: 1 };
    const created = await this.port.createWorkspace(record);
    if (!created.created && created.record.createdBy !== actor.actorId) throw applicationError('工作区标识已被其他成员使用。', 'WORKSPACE_ID_CONFLICT', 'conflict', 'refresh', false, 409);
    return created;
  }
  private async update(record: WorkspaceRecord, next: WorkspaceRecord) {
    const persisted = await this.port.updateWorkspace(next, record.revision);
    if (!persisted) throw applicationError('工作区版本已变化，请刷新后重试。', 'WORKSPACE_REVISION_CONFLICT', 'conflict', 'refresh', false, 409);
    return persisted;
  }
  rename(record: WorkspaceRecord, name: string) { return this.update(record, { ...record, name, revision: record.revision + 1 }); }
  status(record: WorkspaceRecord, status: WorkspaceRecord['status']) { return this.update(record, { ...record, status, revision: record.revision + 1 }); }
}
