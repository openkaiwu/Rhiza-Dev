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

const port = Number(process.env.API_PORT || process.env.PORT || 8787);
const provider = new ProviderService(new ProviderStore(), new SecretVault(), loadAiConfig());
const featureFlags = loadFeatureFlags();
let store: WorkspaceRepository;
if (featureFlags.postgresPersistence) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required when postgresPersistence is enabled');
  store = PostgresWorkspaceStore.fromConnectionString(process.env.DATABASE_URL, process.env.RHIZA_PROJECT_ID);
} else {
  store = await openEmbeddedWorkspaceStore(process.env.RHIZA_EMBEDDED_DATA_DIR, process.env.RHIZA_PROJECT_ID);
}
const serveFrontend = process.env.SERVE_FRONTEND !== 'false';
const runtime = new ProviderRuntime(provider);
const app = createApp(store, provider, serveFrontend, runtime, featureFlags);

app.listen(port, '127.0.0.1', () => {
  console.info(`[api] Rhiza backend listening on http://127.0.0.1:${port} runtime=${runtime.kind}`);
  provider.activeStatus().then(status => console.info(`[api] AI provider=${status.name} model=${status.model} configured=${status.configured}`)).catch(error => console.error('[api] provider initialization failed', error));
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, async () => {
  await store.close?.();
  process.exit(0);
});
