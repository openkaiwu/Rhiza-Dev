import { PostgresWorkspaceStore } from '../server/postgres-store';

if (process.env.RHIZA_OFFLINE_TRACE_SANITIZATION !== '1' || !process.env.DATABASE_URL) {
  throw new Error('Offline trace sanitization requires RHIZA_OFFLINE_TRACE_SANITIZATION=1 and DATABASE_URL');
}

const store = PostgresWorkspaceStore.fromConnectionString(process.env.DATABASE_URL);
try {
  await store.acquireRuntimeOwnership();
  let migrated = 0;
  let batch: number;
  do { batch = await store.sanitizeLegacyRunTraces(); migrated += batch; } while (batch === 100);
  const audit = await store.auditRunTraceMetadata();
  console.info(JSON.stringify({ migrated, audit }));
  if (audit.invalid) throw new Error('RUN_TRACE_METADATA_INVALID');
} finally { await store.close(); }
