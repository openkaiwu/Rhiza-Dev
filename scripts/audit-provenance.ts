import { PostgresWorkspaceStore } from '../server/postgres-store';

if (!process.env.DATABASE_URL) throw new Error('M09 provenance audit requires DATABASE_URL');
const store = PostgresWorkspaceStore.fromConnectionString(process.env.DATABASE_URL);
try {
  const counts = await store.auditProvenanceCoverage();
  console.info(JSON.stringify({ scope: 'all-workspaces', provenanceCoverage: counts }));
  if (counts.missing || counts.broken || counts.invalid) throw new Error('M09_PROVENANCE_COVERAGE_INCOMPLETE');
} finally { await store.close(); }
