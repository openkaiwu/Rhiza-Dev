import { resolve } from 'node:path';
import { LOCAL_USER_ID } from '../server/identity/workspace-scope';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { relationalizeWorkspace } from '../server/postgres-store';
import { semanticChecksum } from '../server/infrastructure/workspace-semantic-checksum';
import { WorkspaceStore } from '../server/store';
import { DEFAULT_WORKSPACE_ID } from '../server/identity/workspace-scope';

const sourcePath = resolve(process.env.RHIZA_JSON_IMPORT_PATH || 'var/workspace.json');
const legacy = new WorkspaceStore(sourcePath);
const workspace = await legacy.read();
const workspaceId = process.env.RHIZA_PROJECT_ID || (/^[0-9a-f-]{36}$/i.test(workspace.projectId) ? workspace.projectId : DEFAULT_WORKSPACE_ID);
const embedded = await openEmbeddedWorkspaceStore(process.env.RHIZA_EMBEDDED_DATA_DIR, workspaceId);

try {
  await embedded.workspaceDirectory.ensureWorkspace({
    workspaceId,
    name: workspace.projectTitle,
    status: 'active',
    createdBy: LOCAL_USER_ID,
    revision: 1,
  });
  const expected = relationalizeWorkspace(workspace, workspaceId);
  await embedded.initialize(expected);
  const recovered = await embedded.read();
  const expectedChecksum = semanticChecksum(expected);
  const recoveredChecksum = semanticChecksum(recovered);
  if (expectedChecksum !== recoveredChecksum) throw new Error(`JSON import semantic mismatch: expected=${expectedChecksum} recovered=${recoveredChecksum}`);
  const backfill = await embedded.backfillJournal();
  console.info(JSON.stringify({ imported: sourcePath, workspaceId, reconcile: 'match', expectedChecksum, recoveredChecksum, ...backfill }));
} finally {
  await embedded.close();
}
