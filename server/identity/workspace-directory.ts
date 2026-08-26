import type { ActorRef, ScopeRef } from '../contracts/references';
import type { WorkspaceRecord } from '../contracts/application';
import { assertWorkspaceScope } from './workspace-scope';

export interface WorkspaceDirectoryPort {
  listWorkspaces(userId: string, includeArchived?: boolean): Promise<WorkspaceRecord[]>;
  createWorkspace(record: WorkspaceRecord): Promise<void>;
  updateWorkspace(record: WorkspaceRecord): Promise<void>;
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
  async create(actor: ActorRef, workspaceId: string, name: string) { const record: WorkspaceRecord = { workspaceId, name, status: 'active', createdBy: actor.actorId, revision: 1 }; await this.port.createWorkspace(record); return record; }
  async rename(record: WorkspaceRecord, name: string) { const next = { ...record, name, revision: record.revision + 1 }; await this.port.updateWorkspace(next); return next; }
  async status(record: WorkspaceRecord, status: WorkspaceRecord['status']) { const next = { ...record, status, revision: record.revision + 1 }; await this.port.updateWorkspace(next); return next; }
}
