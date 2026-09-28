import { resolve } from 'node:path';
import { PostgresWorkspaceStore } from '../server/postgres-store';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { NodeContentKeys } from '../server/infrastructure/node-content-keys';
import { NodeEncryptedBlobStore } from '../server/infrastructure/node-encrypted-blob-store';
import { NodeFilesystemBlobStore } from '../server/infrastructure/node-host-runtime';
import { NodeSealedContentStore } from '../server/infrastructure/node-sealed-content-store';

const uploadDirectory = resolve(process.env.RHIZA_UPLOAD_DIR || 'var/uploads');
const source = new NodeFilesystemBlobStore(uploadDirectory);
const target = new NodeEncryptedBlobStore(
  new NodeSealedContentStore(source, new NodeContentKeys(resolve(uploadDirectory, 'resource-keys'))),
  source,
);
const store = process.env.DATABASE_URL
  ? PostgresWorkspaceStore.fromConnectionString(process.env.DATABASE_URL, process.env.RHIZA_PROJECT_ID)
  : await openEmbeddedWorkspaceStore(process.env.RHIZA_EMBEDDED_DATA_DIR, process.env.RHIZA_PROJECT_ID, 'verify');

try {
  await store.acquireRuntimeOwnership();
  for (const workspaceId of await store.listWorkspaceIds()) {
    const scoped = store.forWorkspace(workspaceId) as PostgresWorkspaceStore;
    let migrated = 0;
    let batch: number;
    do { batch = await scoped.sealLegacyResourceBlobs(source, target); migrated += batch; } while (batch === 100);
    console.info(JSON.stringify({ workspaceId, migrated }));
  }
} finally { await store.close(); }
