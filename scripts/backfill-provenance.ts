import { PostgresWorkspaceStore } from '../server/postgres-store';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';

const workspaceId = process.env.RHIZA_PROJECT_ID || '00000000-0000-4000-8000-000000000001';
const store = process.env.DATABASE_URL
  ? PostgresWorkspaceStore.fromConnectionString(process.env.DATABASE_URL, workspaceId)
  : await openEmbeddedWorkspaceStore(process.env.RHIZA_EMBEDDED_DATA_DIR, workspaceId, 'verify');
try {
  const results = [];
  for (const id of await store.listWorkspaceIds()) {
    const inserted = await (store.forWorkspace(id) as PostgresWorkspaceStore).backfillProvenance();
    results.push({ workspaceId: id, inserted });
  }
  console.info(JSON.stringify({ workspaces: results }));
} finally { await store.close(); }
