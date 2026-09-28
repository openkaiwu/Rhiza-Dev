import { PostgresWorkspaceStore } from '../server/postgres-store';

if (!process.env.DATABASE_URL) throw new Error('M09 plaintext audit requires DATABASE_URL');
const store = PostgresWorkspaceStore.fromConnectionString(process.env.DATABASE_URL);
try {
  await store.acquireRuntimeOwnership();
  const counts = await store.auditLegacyPlaintextReplicas();
  const purgeReceipts = await store.auditPurgeReceiptReasons();
  console.info(JSON.stringify({ scope: 'all-workspaces', legacyPlaintextReplicas: counts, purgeReceipts }));
  if (Object.values(counts).some(count => count !== 0) || purgeReceipts.unsafe !== 0) throw new Error('M09_LEGACY_PLAINTEXT_REPLICAS_REMAIN');
} finally { await store.close(); }
