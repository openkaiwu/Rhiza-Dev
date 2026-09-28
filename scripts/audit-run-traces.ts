import { PostgresWorkspaceStore } from '../server/postgres-store';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';

const store = process.env.DATABASE_URL
  ? PostgresWorkspaceStore.fromConnectionString(process.env.DATABASE_URL, process.env.RHIZA_PROJECT_ID)
  : await openEmbeddedWorkspaceStore(process.env.RHIZA_EMBEDDED_DATA_DIR, process.env.RHIZA_PROJECT_ID, 'verify');
try {
  const audit = await store.auditRunTraceMetadata();
  console.info(JSON.stringify(audit));
  if (audit.invalid) throw new Error('RUN_TRACE_METADATA_INVALID');
} finally { await store.close(); }
