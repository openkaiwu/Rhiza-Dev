import { resolve } from 'node:path';
import { BUNDLE_IMPORT_RECOVERY_WINDOW_MS } from '../server/domain/portable-bundle';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { NodeImportArchiveStore } from '../server/infrastructure/portable-content';
import { PostgresWorkspaceStore } from '../server/postgres-store';

const store = process.env.DATABASE_URL
  ? PostgresWorkspaceStore.fromConnectionString(process.env.DATABASE_URL, process.env.RHIZA_PROJECT_ID)
  : await openEmbeddedWorkspaceStore(process.env.RHIZA_EMBEDDED_DATA_DIR, process.env.RHIZA_PROJECT_ID, 'verify');
try {
  await store.acquireRuntimeOwnership();
  const archives = new NodeImportArchiveStore(resolve(process.env.RHIZA_UPLOAD_DIR || 'var/uploads', 'imports'));
  const pins = await store.retainedImportArchivePins();
  for (const digest of pins) await archives.migrateLegacy(digest);
  console.info(JSON.stringify(await archives.reclaim(pins, BUNDLE_IMPORT_RECOVERY_WINDOW_MS)));
} finally { await store.close(); }
