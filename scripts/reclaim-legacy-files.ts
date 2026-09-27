import { resolve } from 'node:path';
import { PostgresWorkspaceStore } from '../server/postgres-store';
import { NodeContentKeys } from '../server/infrastructure/node-content-keys';
import { NodeEncryptedBlobStore } from '../server/infrastructure/node-encrypted-blob-store';
import { NodeFilesystemBlobStore } from '../server/infrastructure/node-host-runtime';
import { NodeSealedContentStore } from '../server/infrastructure/node-sealed-content-store';

if (process.env.RHIZA_OFFLINE_FILE_RECLAMATION !== '1' || !process.env.DATABASE_URL || !process.env.RHIZA_UPLOAD_DIR) {
  throw new Error('M09 file reclamation requires stopped deployment, RHIZA_OFFLINE_FILE_RECLAMATION=1, DATABASE_URL and RHIZA_UPLOAD_DIR');
}
const uploadDirectory = resolve(process.env.RHIZA_UPLOAD_DIR);
const raw = new NodeFilesystemBlobStore(uploadDirectory);
const blobs = new NodeEncryptedBlobStore(new NodeSealedContentStore(raw, new NodeContentKeys(resolve(uploadDirectory, 'resource-keys'))), raw);
const store = PostgresWorkspaceStore.fromConnectionString(process.env.DATABASE_URL);
try {
  const removed = { resourceBlobs: 0, attachments: 0 };
  let batch;
  do {
    batch = await store.reclaimLegacyResourceFiles(uploadDirectory, blobs);
    removed.resourceBlobs += batch.resourceBlobs;
    removed.attachments += batch.attachments;
  } while (batch.resourceBlobs + batch.attachments === 100);
  console.info(JSON.stringify({ scope: 'all-workspaces', removedKnownPlaintextFiles: removed }));
} finally { await store.close(); }
