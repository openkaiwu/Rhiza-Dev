// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './api';

afterEach(() => {
  api.setWorkspace();
  vi.unstubAllGlobals();vi.useRealTimers();
});

it('previews current Context and Replay without mutations, then confirms the exact reviewed source in the same Workspace', async () => {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ items: [], recommendations: [], policies: [] }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  api.setWorkspace('research workspace');
  await api.getContextPreview('预算 & 来源', ['file/1']);
  await api.getReplayPreflight('run/1');
  const decision = { sourceType: 'node' as const, sourceId: 'source/1', sourceRevision: 'a'.repeat(64), decision: 'accept' as const, reason: '本轮需要这份证据' };
  await api.decideContextRecommendation(decision, 'decision-key');
  expect(fetch.mock.calls[0]).toEqual(['/api/v1/workspaces/research%20workspace/workspace/context/preview?query=%E9%A2%84%E7%AE%97+%26+%E6%9D%A5%E6%BA%90&attachmentIds=file%2F1', { headers: { 'Content-Type': 'application/json' } }]);
  expect(fetch.mock.calls[1]).toEqual(['/api/v1/workspaces/research%20workspace/runs/run%2F1/replay/preflight', { headers: { 'Content-Type': 'application/json' } }]);
  expect(fetch.mock.calls[2]).toEqual(['/api/v1/workspaces/research%20workspace/workspace/context/decisions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'decision-key' }, body: JSON.stringify(decision) }]);
  await api.getManifestContext('manifest/1');
  expect(fetch.mock.calls[3][0]).toBe('/api/v1/workspaces/research%20workspace/context/manifests/manifest%2F1');
});

it('preserves a stale Context decision as a conflict and never retries or replaces its reviewed version automatically', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'CONTEXT_SELECTION_STALE', message: '来源已变化', category: 'conflict', retryable: false } }), { status: 409 }));
  vi.stubGlobal('fetch', fetch);
  api.setWorkspace('original');
  const decision = { sourceType: 'file' as const, sourceId: 'file', sourceRevision: 'b'.repeat(64), decision: 'accept' as const, reason: '已审阅' };
  await expect(api.decideContextRecommendation(decision, 'same-operation')).rejects.toMatchObject({ code: 'CONTEXT_SELECTION_STALE', status: 409, category: 'conflict', retryable: false });
  expect(fetch).toHaveBeenCalledOnce();
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(decision);
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

it('consumes collaboration state and participant failures without treating them as a failed aggregate stream', async () => {
  const frames = [
    'event: collaboration\ndata: {"type":"COLLABORATION_STATE","collaborationId":"session","revision":2,"status":"running","attempts":[],"budget":{}}',
    'event: collaboration\ndata: {"type":"RUN_ERROR","collaborationId":"session","participantId":"b","round":1,"requestId":"run-b","code":"PROVIDER_TIMEOUT","message":"B failed","status":504}',
    'event: commit\ndata: {"type":"COLLABORATION_COMMIT","collaboration":{"id":"session","status":"partial"}}',
  ].join('\n\n') + '\n\n';
  const fetch = vi.fn().mockResolvedValue(new Response(frames, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })); vi.stubGlobal('fetch', fetch); api.setWorkspace('workspace');
  const events = vi.fn(); const controller = new AbortController();
  expect(await api.streamCollaboration('session', events, 'stable-stream-key', controller.signal)).toEqual({ collaboration: { id: 'session', status: 'partial' } });
  expect(events).toHaveBeenCalledTimes(2); expect(events.mock.calls[1][0]).toMatchObject({ participantId: 'b', type: 'RUN_ERROR' });
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/workspaces/workspace/collaborations/session/stream'); expect(fetch.mock.calls[0][1].headers['Idempotency-Key']).toBe('stable-stream-key');
});

it('preserves aggregate collaboration errors and never repeats an external invocation automatically', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('event: error\ndata: {"type":"COLLABORATION_ERROR","code":"COLLABORATION_ALREADY_STARTED","message":"Review required","status":409}\n\n', { status: 200 })); vi.stubGlobal('fetch', fetch);
  await expect(api.streamCollaboration('session', vi.fn(), 'stable-key', new AbortController().signal)).rejects.toMatchObject({ code: 'COLLABORATION_ALREADY_STARTED', status: 409 }); expect(fetch).toHaveBeenCalledOnce();
});


it('requests the exact typed graph identity and version within its Workspace', async () => {
 const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({graph:{objects:[],relations:[]}}),{status:200}));vi.stubGlobal('fetch',fetch);api.setWorkspace('scope');
 await api.getGraphNeighborhood({objectType:'message',objectId:'m/old',versionId:'v/1',objectTypes:['conversation','segment','message'],depth:2,nodeLimit:200,edgeLimit:800});
 const url=new URL(fetch.mock.calls[0][0],'http://localhost');expect(url.pathname).toBe('/api/v1/workspaces/scope/graph/neighborhood');expect(Object.fromEntries(url.searchParams)).toMatchObject({objectType:'message',objectId:'m/old',versionId:'v/1',objectTypes:'conversation,segment,message',nodeLimit:'200'});expect(fetch).toHaveBeenCalledOnce();
});
