// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './api';

afterEach(() => {
  api.setWorkspace();
  vi.unstubAllGlobals();vi.useRealTimers();
});

it('uploads raw bundle content globally with a stable retry key', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ workspaceId: 'imported', importId: 'job' }), { status: 201 }));
  vi.stubGlobal('fetch', fetch);
  api.setWorkspace('existing');
  const file = new File(['archive'], 'workspace.rhiza');
  await api.importWorkspaceBundle(file, 'retry-key');
  expect(fetch).toHaveBeenCalledWith('/api/bundle/import', {
    method: 'POST', body: file, headers: { 'Content-Type': 'application/vnd.rhiza.workspace+zip', 'Idempotency-Key': 'retry-key' },
  });
  await api.previewWorkspaceBundle(file);
  expect(fetch).toHaveBeenLastCalledWith('/api/bundle/preview', {
    method: 'POST', body: file, headers: { 'Content-Type': 'application/vnd.rhiza.workspace+zip' },
  });
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

it('reports pending cancellation when command lookup never finds the Run',async()=>{
 vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>new Response(JSON.stringify({run:null}),{status:200})));const result=api.cancelAttempt('not-created',undefined,'original-workspace');const assertion=expect(result).rejects.toMatchObject({code:'RUN_LOOKUP_PENDING'});await vi.runAllTimersAsync();await assertion;vi.useRealTimers();
});
