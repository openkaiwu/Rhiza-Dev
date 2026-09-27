import { resolve } from 'node:path';
import { PostgresWorkspaceStore } from '../server/postgres-store';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { NodeContentKeys } from '../server/infrastructure/node-content-keys';
import { NodeEncryptedBlobStore } from '../server/infrastructure/node-encrypted-blob-store';
import { NodeFilesystemBlobStore } from '../server/infrastructure/node-host-runtime';
import { NodeSealedContentStore } from '../server/infrastructure/node-sealed-content-store';

const reclaim = process.argv.includes('--reclaim');
if (reclaim && process.env.RHIZA_OFFLINE_KEY_RECONCILIATION !== '1') {
  throw new Error('Set RHIZA_OFFLINE_KEY_RECONCILIATION=1 only after stopping every content-directory publisher');
}
const uploadDirectory = resolve(process.env.RHIZA_UPLOAD_DIR || 'var/uploads');
const legacyBlobs = new NodeFilesystemBlobStore(uploadDirectory);
const blobs = new NodeEncryptedBlobStore(new NodeSealedContentStore(
  legacyBlobs, new NodeContentKeys(resolve(uploadDirectory, 'resource-keys')),
), legacyBlobs);
const store = process.env.DATABASE_URL
  ? PostgresWorkspaceStore.fromConnectionString(process.env.DATABASE_URL, process.env.RHIZA_PROJECT_ID)
  : await openEmbeddedWorkspaceStore(process.env.RHIZA_EMBEDDED_DATA_DIR, process.env.RHIZA_PROJECT_ID, 'verify');
try {
  if (reclaim) await store.acquireRuntimeOwnership();
  const documentKeys = await store.auditHistoricalKeys();
  const resourceKeys = await store.auditResourceBlobKeys(blobs);
  const records = [...Object.values(documentKeys).flat(), ...resourceKeys];
  if (records.some(record => record.referenced && record.state !== 'active')) throw new Error('CONTENT_KEY_REFERENCES_UNHEALTHY');
  const revoked = reclaim
    ? { documents: await store.reclaimHistoricalKeys(), resourceVersions: await store.reclaimResourceBlobKeys(blobs) }
    : undefined;
  console.info(JSON.stringify({ scope: 'all-workspaces', referenced: records.filter(record => record.referenced).length,
    unreferencedActive: records.filter(record => !record.referenced && record.state === 'active').length,
    ...(revoked ? { revoked } : { mode: 'audit-only' }) }));
} finally { await store.close(); }
