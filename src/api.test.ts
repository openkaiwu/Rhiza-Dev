// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './api';

afterEach(() => {
  api.setWorkspace();
  vi.unstubAllGlobals();
});

it('keeps the first workspace read legacy, then scopes subsequent requests to its configured default', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ workspace: { projectId: 'custom-default' } }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);

  await api.getWorkspace();
  api.setWorkspace('custom-default');
  await api.setMode('Assisted');

  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/workspace', '/api/v1/workspaces/custom-default/workspace/mode']);
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
