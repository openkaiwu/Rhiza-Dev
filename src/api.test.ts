// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './api';

const defaultWorkspaceId = '00000000-0000-4000-8000-000000000001';

afterEach(() => {
  api.setWorkspace(defaultWorkspaceId);
  vi.unstubAllGlobals();
});

it('binds workspace data requests to the selected path while keeping provider requests global', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ workspace: {}, catalog: {}, presets: {} }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const workspaceId = '00000000-0000-4000-8000-000000000099';

  api.setWorkspace(workspaceId);
  await api.setContextStatus('context-1', 'active');
  await api.createGraphNode({ title: 'Scoped', x: 10, y: 20 });
  await api.sendMessage('Scoped chat');
  await api.getProviders();

  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    `/api/v1/workspaces/${workspaceId}/workspace/context/context-1`,
    `/api/v1/workspaces/${workspaceId}/graph/nodes`,
    `/api/v1/workspaces/${workspaceId}/chat`,
    '/api/providers',
  ]);
});
