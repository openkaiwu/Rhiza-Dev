import { resolve } from 'node:path';
import { NodeHostRuntimeAdapter } from '../server/infrastructure/node-host-runtime';
import { backfillWorkspaceResources } from '../server/infrastructure/resource-backfill';
import { LOCAL_USER_ID } from '../server/identity/workspace-scope';
import { PostgresWorkspaceStore } from '../server/postgres-store';
import { WorkspaceStore, type WorkspaceRepository } from '../server/store';

const root = resolve(process.env.RHIZA_UPLOAD_DIR || 'var/uploads');
const defaultWorkspaceId = process.env.RHIZA_PROJECT_ID;
const store: WorkspaceRepository = process.env.DATABASE_URL
  ? PostgresWorkspaceStore.fromConnectionString(process.env.DATABASE_URL, defaultWorkspaceId)
  : new WorkspaceStore(undefined, false, defaultWorkspaceId);
const host = new NodeHostRuntimeAdapter(root);

try {
  const records = await store.workspaceDirectory?.listWorkspaces(LOCAL_USER_ID, true) || [];
  const workspaceIds = [...new Set([store.defaultWorkspaceId, ...records.map(item => item.workspaceId)].filter((item): item is string => Boolean(item)))];
  const results = [];
  for (const workspaceId of workspaceIds) {
    const repository = workspaceId === store.defaultWorkspaceId ? store : store.forWorkspace?.(workspaceId);
    if (!repository) continue;
    const result = await backfillWorkspaceResources(repository, host);
    results.push({ workspaceId, migrated: result.migrated, dangling: result.dangling, checksum: result.checksum });
  }
  console.log(JSON.stringify({ results }, null, 2));
  if (results.some(item => item.dangling)) process.exitCode = 1;
} finally {
  await store.close?.();
}
