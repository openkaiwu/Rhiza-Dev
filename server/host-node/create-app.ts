import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AIRuntime } from '../ai-runtime';
import { createRhizaApplication } from '../application/create-application';
import { LegacyContextPlanner } from '../context-runtime/legacy-planner';
import { loadFeatureFlags, type FeatureFlags } from '../feature-flags';
import { createHttpApp } from '../http/app';
import { NodeFilesystemLegacyUpload } from '../infrastructure/node-filesystem-legacy-upload';
import { RepositoryWorkspaceUnitOfWork } from '../infrastructure/workspace-repository-unit-of-work';
import { WorkspaceDirectory } from '../identity/workspace-directory';
import { DEFAULT_WORKSPACE_ID } from '../identity/workspace-scope';
import { providerPresets, type ProviderService } from '../provider-service';
import { ProviderRuntime } from '../runtime-adapters/provider-runtime';
import type { WorkspaceRepository } from '../store';

/** Node composition root retained behind the historical `createApp` signature. */
export function createApp(
  store: WorkspaceRepository,
  provider: ProviderService,
  serveFrontend = false,
  runtime: AIRuntime = new ProviderRuntime(provider),
  featureFlags: FeatureFlags = loadFeatureFlags(),
  uploadDirectory = resolve('var/uploads'),
) {
  const defaultWorkspaceId = store.defaultWorkspaceId ?? DEFAULT_WORKSPACE_ID;
  const upload = new NodeFilesystemLegacyUpload(uploadDirectory);
  const application = createRhizaApplication({
    unitOfWork: new RepositoryWorkspaceUnitOfWork(store),
    runtime,
    providers: provider,
    uploads: upload,
    textExtraction: upload,
    planner: new LegacyContextPlanner(randomUUID),
    id: randomUUID,
    now: () => new Date().toISOString(),
    log: console,
    workspaceDirectory: new WorkspaceDirectory(store.workspaceDirectory ?? {
      listWorkspaces: async () => [],
      createWorkspace: async () => { throw new Error('Workspace directory is unavailable'); },
      updateWorkspace: async () => { throw new Error('Workspace directory is unavailable'); },
      ensureWorkspace: async () => { throw new Error('Workspace directory is unavailable'); },
    }),
    defaultWorkspaceId,
  });
  const frontendDirectory = resolve('dist');
  return createHttpApp(application, {
    id: randomUUID,
    runtimeKind: runtime.kind || 'provider-adapter',
    featureFlags,
    providerPresets,
    defaultWorkspaceId,
    ...(serveFrontend && existsSync(frontendDirectory) ? { frontendDirectory } : {}),
    log: console,
  });
}
