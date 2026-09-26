import { createApp } from './app';
import { loadAiConfig } from './config';
import { ProviderService } from './provider-service';
import { ProviderRuntime } from './provider-runtime';
import { ProviderStore } from './provider-store';
import { loadFeatureFlags } from './feature-flags';
import { PostgresWorkspaceStore } from './postgres-store';
import { SecretVault } from './secret-vault';
import type { WorkspaceRepository } from './store';
import { openEmbeddedWorkspaceStore } from './embedded-store';
import { resolve } from 'node:path';
import { BUNDLE_IMPORT_RECOVERY_WINDOW_MS } from './domain/portable-bundle';
import { NodeImportArchiveStore } from './infrastructure/portable-content';

const port = Number(process.env.API_PORT || process.env.PORT || 8787);
const provider = new ProviderService(new ProviderStore(), new SecretVault(), loadAiConfig());
const featureFlags = loadFeatureFlags();
let store: WorkspaceRepository;
if (process.env.DATABASE_URL || featureFlags.postgresPersistence) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required when postgresPersistence is enabled');
  store = PostgresWorkspaceStore.fromConnectionString(process.env.DATABASE_URL, process.env.RHIZA_PROJECT_ID);
} else {
  store = await openEmbeddedWorkspaceStore(process.env.RHIZA_EMBEDDED_DATA_DIR, process.env.RHIZA_PROJECT_ID);
}
if (!(store instanceof PostgresWorkspaceStore)) throw new Error('Chat execution requires transactional persistence');
await store.acquireRuntimeOwnership();
const purgeRecovery = await store.resumePendingPurges();
if (purgeRecovery.pending) console.warn(`[api] ${purgeRecovery.pending} purge checkpoint(s) remain pending key revocation`);
const uploadDirectory = resolve(process.env.RHIZA_UPLOAD_DIR || 'var/uploads');
const retainedArchives = new NodeImportArchiveStore(resolve(uploadDirectory, 'imports'));
const archivePins = await store.retainedImportArchivePins();
for (const digest of archivePins) await retainedArchives.migrateLegacy(digest);
const archiveRecovery = await retainedArchives.reclaim(archivePins, BUNDLE_IMPORT_RECOVERY_WINDOW_MS);
if (archiveRecovery.released) console.info(`[api] released ${archiveRecovery.released} expired import archive(s)`);
await store.reconcileRuns();
const serveFrontend = process.env.SERVE_FRONTEND !== 'false';
const runtime = new ProviderRuntime(provider);
const app = createApp(store, provider, serveFrontend, runtime, featureFlags, uploadDirectory);

app.listen(port, '127.0.0.1', () => {
  console.info(`[api] Rhiza backend listening on http://127.0.0.1:${port} runtime=${runtime.kind}`);
  provider.activeStatus().then(status => console.info(`[api] AI provider=${status.name} model=${status.model} configured=${status.configured}`)).catch(error => console.error('[api] provider initialization failed', error));
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, async () => {
  await store.close?.();
  process.exit(0);
});
