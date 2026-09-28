import { PostgresWorkspaceStore } from '../server/postgres-store';

if (process.env.RHIZA_OFFLINE_RUN_ERROR_SANITIZATION !== '1' || !process.env.DATABASE_URL) {
  throw new Error('Offline Run error sanitization requires RHIZA_OFFLINE_RUN_ERROR_SANITIZATION=1 and DATABASE_URL');
}

const store = PostgresWorkspaceStore.fromConnectionString(process.env.DATABASE_URL);
try {
  await store.acquireRuntimeOwnership();
  let migrated = 0;
  let batch: number;
  do { batch = await store.sanitizeLegacyRunErrors(); migrated += batch; } while (batch === 100);
  const unsafe = (await store.auditLegacyPlaintextReplicas()).run_error_details;
  console.info(JSON.stringify({ migrated, unsafe }));
  if (unsafe) throw new Error('RUN_ERROR_DETAILS_REMAIN');
} finally { await store.close(); }
