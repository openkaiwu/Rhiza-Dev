import { resolve } from 'node:path';
import { PostgresWorkspaceStore } from '../server/postgres-store';
import { NodeContentKeys } from '../server/infrastructure/node-content-keys';
import { NodeEncryptedBlobStore } from '../server/infrastructure/node-encrypted-blob-store';
import { NodeFilesystemBlobStore } from '../server/infrastructure/node-host-runtime';
import { NodeSealedContentStore } from '../server/infrastructure/node-sealed-content-store';

if (!process.env.DATABASE_URL) throw new Error('M09 provenance audit requires DATABASE_URL');
if (!process.env.RHIZA_UPLOAD_DIR) throw new Error('M09 provenance audit requires its matching RHIZA_UPLOAD_DIR');
const uploadDirectory = resolve(process.env.RHIZA_UPLOAD_DIR);
const raw = new NodeFilesystemBlobStore(uploadDirectory);
const blobs = new NodeEncryptedBlobStore(new NodeSealedContentStore(
  raw, new NodeContentKeys(resolve(uploadDirectory, 'resource-keys')),
), raw);
const store = PostgresWorkspaceStore.fromConnectionString(process.env.DATABASE_URL);
try {
  await store.acquireRuntimeOwnership();
  const counts = await store.auditProvenanceCoverage();
  const history = await store.auditProvenanceInputHistory();
  const sources = await store.auditProvenanceSourceIntegrity(blobs);
  console.info(JSON.stringify({ scope: 'all-workspaces', provenanceCoverage: counts, inputHistory: history, sources }));
  if (counts.missing || counts.broken || counts.invalid || history.mismatched || sources.unresolved) throw new Error('M09_PROVENANCE_COVERAGE_INCOMPLETE');
} finally { await store.close(); }
