import { resolve } from 'node:path';
import { Pool } from 'pg';
import { loadMigrations } from './migrate';
import { PostgresWorkspaceStore } from '../server/postgres-store';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { NodeEncryptedBlobStore } from '../server/infrastructure/node-encrypted-blob-store';
import { NodeImportArchiveStore } from '../server/infrastructure/portable-content';
import { inspectM10Store } from './m10-inspection';

let store: PostgresWorkspaceStore | undefined;
try {
  if (!process.env.RHIZA_UPLOAD_DIR || (!process.env.DATABASE_URL && !process.env.RHIZA_EMBEDDED_DATA_DIR)) throw new Error('M10_EXPLICIT_DATA_PATHS_REQUIRED');
  const uploads = resolve(process.env.RHIZA_UPLOAD_DIR);
  const blobs = NodeEncryptedBlobStore.atDirectory(uploads);
  const archives = new NodeImportArchiveStore(resolve(uploads, 'imports'));
  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
    try {
      const applied = await pool.query<{ version: string; checksum: string }>('SELECT version,checksum FROM rhiza_schema_migrations');
      const checksums = new Map(applied.rows.map(item => [item.version, item.checksum]));
      if ((await loadMigrations()).some(item => checksums.get(item.version) !== item.checksum)) throw new Error('M10_SCHEMA_INCOMPATIBLE');
    } finally { await pool.end(); }
    store = PostgresWorkspaceStore.fromConnectionString(process.env.DATABASE_URL, process.env.RHIZA_PROJECT_ID,
      process.env.RHIZA_RECEIPT_CONTENT_DIR || resolve('var/receipt-content'), blobs, archives);
  } else store = await openEmbeddedWorkspaceStore(process.env.RHIZA_EMBEDDED_DATA_DIR, process.env.RHIZA_PROJECT_ID, 'verify', blobs, archives);
  await store.acquireRuntimeOwnership();
  const report = await inspectM10Store(store);
  const sourceIntegrity = await store.auditProvenanceSourceIntegrity(blobs);
  const inputHistory = await store.auditProvenanceInputHistory();
  const resourceBlobs = await store.auditResourceBlobIntegrity(blobs);
  const ok = report.ok && sourceIntegrity.unresolved === 0 && inputHistory.mismatched === 0;
  console.info(JSON.stringify({ ...report, ok, sourceIntegrity, inputHistory, resourceBlobs, externalGate: 'pending' }));
  if (!ok) process.exitCode = 1;
} catch (error) {
  const candidate = error as { code?: string; message?: string };
  const code = candidate.code ?? candidate.message;
  console.info(JSON.stringify({ schemaVersion: '1.0.0', ok: false, error: code && /^[A-Z][A-Z0-9_]+$/.test(code) ? code : 'M10_INSPECTION_FAILED' }));
  process.exitCode = 1;
} finally { await store?.close(); }
