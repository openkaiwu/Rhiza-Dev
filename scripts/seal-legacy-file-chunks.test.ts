import { afterEach, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  acquireRuntimeOwnership: vi.fn(),
  listWorkspaceIds: vi.fn(),
  close: vi.fn(),
}));
vi.mock('../server/postgres-store', () => ({
  PostgresWorkspaceStore: { fromConnectionString: () => store },
}));
vi.mock('../server/embedded-store', () => ({ openEmbeddedWorkspaceStore: () => store }));

afterEach(() => { vi.resetAllMocks(); vi.resetModules(); });

it('closes the store without migrating when runtime ownership is unavailable', async () => {
  store.acquireRuntimeOwnership.mockRejectedValue(new Error('runtime busy'));
  await expect(import('./seal-legacy-file-chunks')).rejects.toThrow('runtime busy');
  expect(store.listWorkspaceIds).not.toHaveBeenCalled();
  expect(store.close).toHaveBeenCalledOnce();
});

it('acquires runtime ownership before enumerating legacy file chunk workspaces', async () => {
  store.listWorkspaceIds.mockResolvedValue([]);
  await import('./seal-legacy-file-chunks');
  expect(store.acquireRuntimeOwnership).toHaveBeenCalledOnce();
  expect(store.acquireRuntimeOwnership.mock.invocationCallOrder[0])
    .toBeLessThan(store.listWorkspaceIds.mock.invocationCallOrder[0]);
  expect(store.close).toHaveBeenCalledOnce();
});
