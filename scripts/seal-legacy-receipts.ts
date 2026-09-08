import { PostgresWorkspaceStore } from '../server/postgres-store';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';

const store = process.env.DATABASE_URL
  ? PostgresWorkspaceStore.fromConnectionString(process.env.DATABASE_URL, process.env.RHIZA_PROJECT_ID)
  : await openEmbeddedWorkspaceStore(process.env.RHIZA_EMBEDDED_DATA_DIR, process.env.RHIZA_PROJECT_ID, 'verify');
try {
  for (const workspaceId of await store.listWorkspaceIds()) {
    const scoped = store.forWorkspace(workspaceId) as PostgresWorkspaceStore;
    let migrated = 0;
    let batch: number;
    do { batch = await scoped.sealLegacyReceiptResults(); migrated += batch; } while (batch === 100);
    console.info(JSON.stringify({ workspaceId, migrated }));
  }
} finally { await store.close(); }
