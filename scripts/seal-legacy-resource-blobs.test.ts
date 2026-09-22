// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

const scoped = { sealLegacyResourceBlobs: vi.fn() };
const store = vi.hoisted(() => ({
  acquireRuntimeOwnership: vi.fn(),
  listWorkspaceIds: vi.fn(),
  forWorkspace: vi.fn(),
  close: vi.fn(),
}));
vi.mock('../server/postgres-store', () => ({ PostgresWorkspaceStore: { fromConnectionString: () => store } }));
vi.mock('../server/embedded-store', () => ({ openEmbeddedWorkspaceStore: () => store }));

afterEach(() => { vi.resetAllMocks(); vi.resetModules(); delete process.env.DATABASE_URL; });

it('owns the runtime and drains restartable resource blob batches', async () => {
  store.listWorkspaceIds.mockResolvedValue(['workspace']);
  store.forWorkspace.mockReturnValue(scoped);
  scoped.sealLegacyResourceBlobs.mockResolvedValueOnce(100).mockResolvedValueOnce(2);
  await import('./seal-legacy-resource-blobs');
  expect(store.acquireRuntimeOwnership).toHaveBeenCalledOnce();
  expect(scoped.sealLegacyResourceBlobs).toHaveBeenCalledTimes(2);
  expect(store.close).toHaveBeenCalledOnce();
});

it('closes without migrating when runtime ownership is unavailable', async () => {
  store.acquireRuntimeOwnership.mockRejectedValue(new Error('runtime busy'));
  await expect(import('./seal-legacy-resource-blobs')).rejects.toThrow('runtime busy');
  expect(store.listWorkspaceIds).not.toHaveBeenCalled();
  expect(store.close).toHaveBeenCalledOnce();
});
