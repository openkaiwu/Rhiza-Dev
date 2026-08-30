import { resolve } from 'node:path';
import { PostgresWorkspaceStore, relationalizeWorkspace } from '../server/postgres-store';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { WorkspaceStore } from '../server/store';
import { semanticChecksum } from '../server/infrastructure/workspace-semantic-checksum';
import { DEFAULT_WORKSPACE_ID } from '../server/identity/workspace-scope';

const source = process.argv[2] === '--' ? process.argv[3] : process.argv[2];
if (!source) throw new Error('Usage: pnpm run journal:reconcile -- <workspace.json>');

const sourcePath = resolve(source);
const legacy = await new WorkspaceStore(sourcePath, true).read();
const workspaceId = process.env.RHIZA_PROJECT_ID || (/^[0-9a-f-]{36}$/i.test(legacy.projectId) ? legacy.projectId : DEFAULT_WORKSPACE_ID);
const store = process.env.DATABASE_URL
  ? PostgresWorkspaceStore.fromConnectionString(process.env.DATABASE_URL, workspaceId)
  : await openEmbeddedWorkspaceStore(process.env.RHIZA_EMBEDDED_DATA_DIR, workspaceId, 'verify');

try {
  const expected = relationalizeWorkspace(legacy, workspaceId);
  const actual = await store.readExisting();
  if (!actual) throw new Error(`Workspace ${workspaceId} does not exist; reconciliation never initializes it`);
  const expectedChecksum = semanticChecksum(expected);
  const actualChecksum = semanticChecksum(actual);
  const match = expectedChecksum === actualChecksum;
  console.info(JSON.stringify({ workspaceId, source: sourcePath, match, expectedChecksum, actualChecksum }));
  if (!match) process.exitCode = 1;
} finally {
  await store.close();
}
