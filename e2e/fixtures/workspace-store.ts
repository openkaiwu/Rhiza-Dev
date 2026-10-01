import { randomUUID } from 'node:crypto';
import { PostgresWorkspaceStore as ProductionStore } from '../../server/postgres-store';
import { openEmbeddedWorkspaceStore as openProductionStore } from '../../server/embedded-store';
import type { WorkspaceData } from '../../server/domain';
import type { WorkspaceRepository, WorkspaceUpdateOptions } from '../../server/store';
import { validateWorkspaceHistoryUpdate } from '../../server/store';
export * from '../../server/postgres-store';

const enabled = new WeakSet<ProductionStore>();
/** An explicit fixture adapter; production composition never imports this module. */
function fixtureStore<T extends ProductionStore>(store: T): T {
  if (enabled.has(store)) return store;
  enabled.add(store);
  store.update = PostgresWorkspaceStore.prototype.update.bind(store as PostgresWorkspaceStore);
  const scoped = store.forWorkspace.bind(store);
  store.forWorkspace = id => fixtureStore(scoped(id) as ProductionStore);
  return store;
}

export class PostgresWorkspaceStore extends ProductionStore {
  override async update(mutator: (current: WorkspaceData) => WorkspaceData | Promise<WorkspaceData>, options?: WorkspaceUpdateOptions) {
    await this.read();
    const result = await this.inTransaction(async database => {
      if (options?.purge) await database.query("SELECT pg_advisory_xact_lock(hashtext('rhiza:workspace-write:' || $1))", [this.defaultWorkspaceId]);
      const current = (await this.readFrom(database, true))!;
      const next = await mutator(structuredClone(current));
      validateWorkspaceHistoryUpdate(current, next, options);
      next.updatedAt = new Date().toISOString();
      next.auditEvents = [...next.auditEvents, { id: randomUUID(), projectId: next.projectId, nodeId: next.activeNodeId,
        action: 'workspace.updated', entityType: 'workspace', entityId: next.projectId,
        metadata: { backend: 'postgres', nodes: next.discussionNodes.length, events: next.messages.length }, createdAt: next.updatedAt }];
      await this.persist(database, next, current, options);
      return next;
    });
    if (options?.purge) await this.resumePendingPurges();
    return result;
  }
  override forWorkspace(id: string): WorkspaceRepository { return fixtureStore(super.forWorkspace(id) as ProductionStore); }
}

export async function openEmbeddedWorkspaceStore(...args: Parameters<typeof openProductionStore>) {
  return fixtureStore(await openProductionStore(...args));
}
