import { PostgresWorkspaceStore } from '../server/postgres-store';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';

const store = process.env.DATABASE_URL
  ? PostgresWorkspaceStore.fromConnectionString(process.env.DATABASE_URL, process.env.RHIZA_PROJECT_ID)
  : await openEmbeddedWorkspaceStore(process.env.RHIZA_EMBEDDED_DATA_DIR, process.env.RHIZA_PROJECT_ID, 'verify');
try {
  console.info(JSON.stringify({
    scope: 'all-workspaces',
    warning: 'Metadata snapshot only; unreferenced keys may belong to in-flight or uncertain commits. No deletion performed.',
    keys: await store.auditReceiptKeys(),
  }));
} finally { await store.close(); }
