import { PostgresWorkspaceStore } from '../server/postgres-store';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { createHash } from 'node:crypto';

const workspaceId = process.env.RHIZA_PROJECT_ID || '00000000-0000-4000-8000-000000000001';
const store = process.env.DATABASE_URL
  ? PostgresWorkspaceStore.fromConnectionString(process.env.DATABASE_URL, workspaceId)
  : await openEmbeddedWorkspaceStore(process.env.RHIZA_EMBEDDED_DATA_DIR, workspaceId);

try {
  const results = [];
  for (const id of await store.listWorkspaceIds()) {
    const target = store.forWorkspace(id) as PostgresWorkspaceStore;
    results.push({ workspaceId: id, ...await target.backfillJournal() });
  }
  const checksum = createHash('sha256').update(JSON.stringify(results.map(({ workspaceId: id, checksum: value, eventCount }) => ({ workspaceId: id, checksum: value, eventCount })))).digest('hex');
  console.info(JSON.stringify({ workspaces: results, checksum }));
} finally {
  await store.close();
}
