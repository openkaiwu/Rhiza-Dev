// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from './App';
import { contextHistoryFixture } from './test/context-history-fixture';
import { initialContext } from './data';
import type { CollaborationRecord, ContextManifest, DiscussionNode, Message } from './types';

const mocks = vi.hoisted(() => { const temporary = vi.fn(); return ({
  getWorkspace: vi.fn(), listCollaborations: vi.fn(), createCollaboration: vi.fn(), streamCollaboration: vi.fn(),
  getMessageContext: vi.fn(), getManifestContext: vi.fn(), getContextPreview: vi.fn(), decideContextRecommendation: vi.fn(),
  getWorkspaceActivity: vi.fn(),
  getGraphNeighborhood: vi.fn(), getGraphPath: vi.fn(),
  setMode: vi.fn(),
  setContextStatus: vi.fn(),
  setContextPin: vi.fn(),
  addContextSource: vi.fn(),
  sendMessage: vi.fn(),
  streamMessage: vi.fn(),
  uploadAttachment: vi.fn(),
  getProviders: vi.fn(),
  saveProvider: vi.fn(),
  discoverModels: vi.fn(),
  updateModel: vi.fn(),
  selectModel: vi.fn(),
  createBranch: vi.fn(), activateNode: vi.fn(), moveNode: vi.fn(), mergeNode: vi.fn(), archiveGraphNode: vi.fn(), restoreGraphNode: vi.fn(),
  sendTemporaryMessage: temporary, streamTemporaryMessage: temporary,
  workspaceId: vi.fn(), findAttemptRun: vi.fn(), cancelAttempt: vi.fn(), searchWorkspace: vi.fn(),
  setConversationModel: vi.fn(), setWorkspaceModel: vi.fn(), renameConversation: vi.fn(),
  setNodeStatus: vi.fn(), updateSegment: vi.fn(), createSegment: vi.fn(), retryRun: vi.fn(),
  setWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
  getScopedWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
}); });

vi.mock('./api', () => ({ api: mocks }));

const workspace = {
  projectId: 'rhiza-product-research', nodeId: 'information-architecture', mode: 'Assisted' as const,
  contextItems: initialContext.map(item => ({ ...item, sourceType: 'node' as const, sourceId: `source-${item.id}`, sourceRevision: `revision-${item.id}` })),
  messages: [
    { id: 'm1', nodeId: 'information-architecture', kind: 'user' as const, text: '原始问题', createdAt: '2026-08-09T12:00:00.000Z' },
    { id: 'm2', nodeId: 'information-architecture', kind: 'assistant' as const, text: '原始回答', createdAt: '2026-08-09T12:00:01.000Z', manifestId: 'manifest-history' },
  ],
  attachments: [],
  discussionNodes: [{ id: 'information-architecture', title: '信息架构方向', summary: '首屏结构探索', status: 'active' as const, kind: 'main' as const, x: 350, y: 150, createdAt: '', updatedAt: '' }],
  discussionEdges: [], anchors: [], activeNodeId: 'information-architecture',
  segments: [{ id: 'segment-1', nodeId: 'information-architecture', ordinal: 0, title: '首屏片段', createdAt: '' }],
  manifests: [{ id: 'manifest-history', projectId: 'rhiza-product-research', nodeId: 'information-architecture', requestId: 'request-history', createdAt: '2026-08-09T12:00:01.000Z', mode: 'Assisted' as const, contextItemIds: ['c1'], excludedItemIds: ['c4'], contextItems: [{ sourceType: 'node' as const, sourceId: 'information-architecture', sourceNodeId: 'information-architecture', title: '信息架构方向', detail: '当前讨论节点', role: 'Constraint' as const, selectionMode: 'CURRENT' as const, pinned: false, reason: '当前讨论节点始终进入本轮上下文。', tokenCount: 1840, contentVersion: 1 }], model: 'history-model', provider: 'Test Provider', runtime: 'provider-adapter' as const, estimatedTokens: 1840, generation: { temperature: 0.4, topP: 1, maxTokens: 2048 }, operation: 'send' as const, attachmentIds: [] }], updatedAt: '2026-08-09T12:00:01.000Z',
};
const providerCatalog = {
  providers: [{ id: 'p1', preset: 'custom', name: 'Test Provider', baseUrl: 'https://example.test/v1', chatPath: '/chat/completions', allowNoKey: false, hasApiKey: true, configured: true, createdAt: '', updatedAt: '' }],
  models: [{ id: 'model-1', providerId: 'p1', modelId: 'test-model', displayName: 'test-model', favorite: false, pinned: false, createdAt: '' }],
  activeModelId: 'model-1',
};
const presets = { openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', allowNoKey: false } };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
};
const scopedWorkspace = (title: string) => ({ ...workspace, discussionNodes: workspace.discussionNodes.map(node => ({ ...node, title })) });
const projectedGraph = (nodes: readonly DiscussionNode[] = workspace.discussionNodes) => ({ graph: {
  version: 'graph-v1', checkpoint: 1,
  objects: nodes.map(node => ({
    ref: { workspaceId: workspace.projectId, objectType: 'conversation', objectId: node.id }, revision: 1,
    lifecycle: node.status, title: node.title, summary: node.summary, kind: node.kind, status: node.status,
    createdAt: node.createdAt, updatedAt: node.updatedAt, layout: { x: node.x, y: node.y },
  })), relations: [],
} });

beforeEach(() => {
  localStorage.clear();
  mocks.listCollaborations.mockResolvedValue({ collaborations: [] });
  mocks.workspaceId.mockReturnValue(undefined);
  mocks.getContextPreview.mockResolvedValue({ mode: workspace.mode, items: workspace.contextItems.filter(item => item.status === 'active'), recommendations: workspace.contextItems.filter(item => item.status === 'recommended'), omissions: [], budget: 32000, usedTokens: 4200, overBudget: false });
  mocks.decideContextRecommendation.mockResolvedValue({ workspace });
  mocks.getManifestContext.mockResolvedValue(contextHistoryFixture);

  mocks.cancelAttempt.mockResolvedValue(undefined);mocks.findAttemptRun.mockResolvedValue(null);
  mocks.searchWorkspace.mockResolvedValue({ results: [] });
  mocks.setConversationModel.mockResolvedValue({ workspace });
  mocks.setWorkspaceModel.mockResolvedValue({ workspace });
  mocks.getWorkspace.mockResolvedValue({ workspace, provider: { configured: true, name: 'Test Provider', model: 'test-model', baseUrl: 'https://example.test/v1' }, providerCatalog });
  mocks.getWorkspaceActivity.mockResolvedValue({ activity: [{ id: 'event-1', sequence: 2, type: 'conversation.run.committed', title: '完成一次对话', detail: 'conversation · information-architecture', occurredAt: '2026-08-30T00:00:00.000Z', aggregateType: 'conversation', aggregateId: 'information-architecture' }] });
  mocks.getGraphNeighborhood.mockResolvedValue(projectedGraph());
  mocks.getProviders.mockResolvedValue({ catalog: providerCatalog, presets });
  mocks.saveProvider.mockResolvedValue({ catalog: providerCatalog });
  mocks.discoverModels.mockResolvedValue({ catalog: providerCatalog });
  mocks.updateModel.mockResolvedValue({ catalog: { ...providerCatalog, models: [{ ...providerCatalog.models[0], favorite: true }] } });
  mocks.selectModel.mockResolvedValue({ catalog: providerCatalog, provider: { configured: true, name: 'Test Provider', model: 'test-model', baseUrl: 'https://example.test/v1' } });
  mocks.activateNode.mockResolvedValue({ workspace });
  mocks.moveNode.mockResolvedValue({ workspace });
  mocks.mergeNode.mockResolvedValue({ workspace });
  mocks.archiveGraphNode.mockResolvedValue({ workspace: { ...workspace, discussionNodes: workspace.discussionNodes.map(node => ({ ...node, status: 'archived' as const })) } });
  mocks.restoreGraphNode.mockResolvedValue({ workspace });
  mocks.createBranch.mockResolvedValue({ workspace: { ...workspace, discussionNodes: [...workspace.discussionNodes, { id: 'branch-1', title: '可用性支线', summary: '原始回答', status: 'active' as const, kind: 'branch' as const, sourceNodeId: 'information-architecture', sourceMessageId: 'm2', anchorText: '原始回答', x: 560, y: 260, createdAt: '', updatedAt: '' }], discussionEdges: [{ id: 'edge-1', source: 'information-architecture', target: 'branch-1', relation: 'derived-from' as const, label: '衍生支线', createdAt: '' }], activeNodeId: 'branch-1' } });
  mocks.sendTemporaryMessage.mockResolvedValue({ userMessage: { id: 'tm1', nodeId: 'temp:information-architecture', kind: 'user', text: '为什么？', createdAt: '2026-08-09T12:02:00.000Z' }, assistantMessage: { id: 'tm2', nodeId: 'temp:information-architecture', kind: 'assistant', text: '临时支线回答', createdAt: '2026-08-09T12:02:01.000Z' }, model: 'test-model' });
  mocks.uploadAttachment.mockResolvedValue({ id: 'attachment-1', name: 'brief.txt', mimeType: 'text/plain', size: 12, kind: 'file', createdAt: '' });
  mocks.setMode.mockResolvedValue({ workspace });
  mocks.setContextStatus.mockImplementation(async (id: string, status: string) => ({ workspace: { ...workspace, contextItems: workspace.contextItems.map(item => item.id === id ? { ...item, status } : item) } }));
  mocks.setContextPin.mockImplementation(async (id: string, pinned: boolean) => ({ workspace: { ...workspace, contextItems: workspace.contextItems.map(item => item.id === id ? { ...item, pinned } : item) } }));
  mocks.addContextSource.mockResolvedValue({ workspace });
  mocks.sendMessage.mockResolvedValue({
    userMessage: { id: 'm3', nodeId: 'information-architecture', kind: 'user', text: '验证这个结构', createdAt: '2026-08-09T12:01:00.000Z' },
    assistantMessage: { id: 'm4', nodeId: 'information-architecture', kind: 'assistant', text: '真实 Provider 回答', createdAt: '2026-08-09T12:01:01.000Z', manifestId: 'manifest-1' },
    manifest: { id: 'manifest-1' },
  });
  mocks.streamMessage.mockImplementation(async (_message: string, onEvent: (event: unknown) => void) => {
    onEvent({ type: 'CONTENT_DELTA', requestId: 'request-1', delta: '真实 Provider ' });
    onEvent({ type: 'CONTENT_DELTA', requestId: 'request-1', delta: '回答' });
    return {
      userMessage: { id: 'm3', nodeId: 'information-architecture', kind: 'user', text: '验证这个结构', createdAt: '2026-08-09T12:01:00.000Z' },
      assistantMessage: { id: 'm4', nodeId: 'information-architecture', kind: 'assistant', text: '真实 Provider 回答', createdAt: '2026-08-09T12:01:01.000Z', manifestId: 'manifest-1' },
      manifest: { id: 'manifest-1' },
    };
  });
  mocks.listWorkspaces.mockResolvedValue({ workspaces: [] });
  mocks.getScopedWorkspace.mockResolvedValue({ workspace });
  mocks.updateWorkspace.mockResolvedValue({ workspace: { workspaceId: '00000000-0000-4000-8000-000000000001', name: 'Default', status: 'archived', createdBy: '00000000-0000-4000-8000-000000000002', revision: 2 } });
});

describe('Rhiza MVP', () => {
  it('discards historical content from the previous Workspace after switching', async () => {
    const pending = deferred<typeof contextHistoryFixture>();
    mocks.getMessageContext.mockReturnValueOnce(pending.promise);
    mocks.listWorkspaces.mockResolvedValueOnce({ workspaces: [
      { workspaceId: workspace.projectId, name: 'First', status: 'active', createdBy: 'local', revision: 1 },
      { workspaceId: 'second-workspace', name: 'Second', status: 'active', createdBy: 'local', revision: 1 },
    ] });
    mocks.getScopedWorkspace.mockResolvedValueOnce({ workspace: { ...workspace, projectId: 'second-workspace', messages: [], manifests: [] } });
    render(<App/>);
    fireEvent.click((await screen.findAllByRole('button', { name: '查看本轮上下文' }))[0]);
    fireEvent.change(await screen.findByRole('combobox', { name: '切换工作区' }), { target: { value: 'second-workspace' } });
    await waitFor(() => expect(mocks.getScopedWorkspace).toHaveBeenCalledWith('second-workspace'));
    pending.resolve(contextHistoryFixture);
    await waitFor(() => expect(screen.queryByRole('heading', { name: '当时的上下文' })).not.toBeInTheDocument());
    expect(screen.queryByText('可访问性约束')).not.toBeInTheDocument();
  });

  it('loads historical context from a message and discards a result after returning to current context', async () => {
    const pending = deferred<typeof contextHistoryFixture>();
    mocks.getMessageContext.mockReturnValueOnce(pending.promise);
    render(<App/>);
    const buttons = await screen.findAllByRole('button', { name: '查看本轮上下文' });
    fireEvent.click(buttons[0]);
    expect(mocks.getMessageContext).toHaveBeenCalledWith('m1');
    expect(screen.getByText('正在读取历史上下文…')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回当前上下文' }));
    pending.resolve(contextHistoryFixture);
    await waitFor(() => expect(screen.getByRole('heading', { name: '本轮上下文' })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: '当时的上下文' })).not.toBeInTheDocument();
    mocks.getMessageContext.mockResolvedValueOnce(contextHistoryFixture);
    fireEvent.click(buttons[1]);
    expect(await screen.findByText('为什么未使用')).toBeInTheDocument();
  });

  it('opens a compact discussion with context available on demand', async () => {
    render(<App/>);
    expect(await screen.findByRole('heading', { level: 1, name: /信息架构方向/ })).toBeInTheDocument();
    expect(screen.queryByText('本轮上下文')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^上下文/ }));
    expect(await screen.findByText('本轮上下文')).toBeInTheDocument();
    expect(screen.getByText('推荐来源需确认后才会发送。')).toBeInTheDocument();
    expect(screen.getByText('根系')).toBeInTheDocument();
    expect(screen.getByText('Rhiza')).toBeInTheDocument();
  });

  it('binds the configured default before sending a version-bound recommendation decision', async () => {
    const customDefault = 'custom-default-workspace';
    mocks.getWorkspace.mockResolvedValueOnce({ workspace: { ...workspace, projectId: customDefault }, provider: { configured: true, name: 'Test Provider', model: 'test-model', baseUrl: 'https://example.test/v1' }, providerCatalog });
    render(<App/>);
    await screen.findByRole('heading', { level: 1, name: /信息架构方向/ });
    expect(mocks.setWorkspace).toHaveBeenCalledWith(customDefault);
    fireEvent.click(screen.getByRole('button', { name: /^上下文/ }));
    fireEvent.click(await screen.findByRole('tab', { name: '待确认 1' }));
    fireEvent.change(screen.getByLabelText('确认理由 竞品模式拆解'), { target: { value: '需要比较导航模式' } });
    fireEvent.click(screen.getByRole('button', { name: '加入本轮' }));
    await waitFor(() => expect(mocks.decideContextRecommendation).toHaveBeenCalledWith({ sourceType: 'node', sourceId: 'source-c3', sourceRevision: 'revision-c3', decision: 'accept', reason: '需要比较导航模式' }, expect.any(String)));
    expect(mocks.setContextStatus).not.toHaveBeenCalled();
  });

  it('shows a stale decision and keeps its retry identity without invoking the model', async () => {
    mocks.decideContextRecommendation.mockClear().mockRejectedValue(new Error('推荐来源已更新'));
    render(<App/>);
    await screen.findByLabelText('输入消息');
    fireEvent.click(screen.getByRole('button', { name: /^上下文/ }));
    fireEvent.click(await screen.findByRole('tab', { name: '待确认 1' }));
    fireEvent.change(screen.getByLabelText('确认理由 竞品模式拆解'), { target: { value: '核对当前设计' } });
    fireEvent.click(screen.getByRole('button', { name: '加入本轮' }));
    await screen.findByText(/推荐确认未完成/);
    fireEvent.click(screen.getByRole('button', { name: '加入本轮' }));
    await waitFor(() => expect(mocks.decideContextRecommendation).toHaveBeenCalledTimes(2));
    expect(mocks.decideContextRecommendation.mock.calls[1]).toEqual(mocks.decideContextRecommendation.mock.calls[0]);
    expect(mocks.streamMessage).not.toHaveBeenCalled();
  });

  it('ignores a late recommendation decision after switching workspace', async () => {
    const delayed = deferred<{ workspace: typeof workspace }>();
    const workspaceB = { ...scopedWorkspace('Workspace B'), projectId: 'workspace-b', contextItems: [] };
    mocks.listWorkspaces.mockResolvedValue({ workspaces: [
      { workspaceId: workspace.projectId, name: 'Workspace A', status: 'active', createdBy: 'local', revision: 1 },
      { workspaceId: 'workspace-b', name: 'Workspace B', status: 'active', createdBy: 'local', revision: 1 },
    ] });
    mocks.decideContextRecommendation.mockReturnValueOnce(delayed.promise);
    mocks.getScopedWorkspace.mockResolvedValueOnce({ workspace: workspaceB });
    render(<App/>);
    await screen.findByLabelText('输入消息');
    fireEvent.click(screen.getByRole('button', { name: /^上下文/ }));
    fireEvent.click(await screen.findByRole('tab', { name: '待确认 1' }));
    fireEvent.change(screen.getByLabelText('确认理由 竞品模式拆解'), { target: { value: '比较方案' } });
    fireEvent.click(screen.getByRole('button', { name: '加入本轮' }));
    fireEvent.change(screen.getByLabelText('切换工作区'), { target: { value: 'workspace-b' } });
    await screen.findByRole('heading', { level: 1, name: /Workspace B/ });
    await act(async () => delayed.resolve({ workspace }));
    expect(screen.getByRole('heading', { level: 1, name: /Workspace B/ })).toBeInTheDocument();
    expect(screen.queryByText('推荐来源已更新')).not.toBeInTheDocument();
  });

  it('ignores late SSE deltas and commits after switching workspaces', async () => {
    const delayed = deferred<{ userMessage: Message; assistantMessage: Message; manifest: ContextManifest }>();
    let emit: (event: { type: 'CONTENT_DELTA'; requestId: string; delta: string }) => void = () => undefined;
    const workspaceB = { ...scopedWorkspace('Workspace B'), projectId: 'workspace-b', contextItems: [] };
    mocks.listWorkspaces.mockResolvedValue({ workspaces: [
      { workspaceId: workspace.projectId, name: 'Workspace A', status: 'active', createdBy: 'local', revision: 1 },
      { workspaceId: 'workspace-b', name: 'Workspace B', status: 'active', createdBy: 'local', revision: 1 },
    ] });
    mocks.streamMessage.mockImplementationOnce((_message: string, onEvent: (event: { type: 'CONTENT_DELTA'; requestId: string; delta: string }) => void) => { emit = onEvent; return delayed.promise; });
    mocks.getScopedWorkspace.mockResolvedValueOnce({ workspace: workspaceB });
    render(<App />);
    await screen.findByLabelText('输入消息');
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: 'A pending' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(mocks.streamMessage).toHaveBeenCalledWith('A pending', expect.any(Function), expect.anything()));
    fireEvent.change(screen.getByLabelText('切换工作区'), { target: { value: 'workspace-b' } });
    await screen.findByRole('heading', { level: 1, name: /Workspace B/ });
    emit({ type: 'CONTENT_DELTA', requestId: 'late-a', delta: 'A late delta' });
    delayed.resolve({
      userMessage: { id: 'late-user', nodeId: 'information-architecture', kind: 'user', text: 'A pending', createdAt: '' },
      assistantMessage: { id: 'late-assistant', nodeId: 'information-architecture', kind: 'assistant', text: 'A final message', createdAt: '', manifestId: 'manifest-a-late' },
      manifest: { ...workspace.manifests[0], id: 'manifest-a-late' },
    });
    await waitFor(() => expect(screen.queryByText('A late delta')).not.toBeInTheDocument());
    expect(screen.queryByText('A pending')).not.toBeInTheDocument();
    expect(screen.queryByText('A final message')).not.toBeInTheDocument();
    expect(screen.queryByText(/manifest-a-late/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /Workspace B/ })).toBeInTheDocument();
  });

  it('pins explicit context and exposes the immutable historical Manifest summary', async () => {
    render(<App />);
    await screen.findByText('原始回答');
    fireEvent.click(screen.getByRole('button', { name: /^上下文/ }));
    fireEvent.click((await screen.findAllByRole('button', { name: '固定' }))[0]);
    await waitFor(() => expect(mocks.setContextPin).toHaveBeenCalled());
    fireEvent.click(screen.getByText(/Context Manifest · manifest/));
    expect(screen.getByText('Test Provider / history-model')).toBeInTheDocument();
    expect(screen.getByText('当前讨论节点始终进入本轮上下文。')).toBeInTheDocument();
  });

  it('navigates between graph and project state views', async () => {
    render(<App />);
    await screen.findByRole('button', { name: /对话图谱/ });
    fireEvent.click(screen.getByRole('button', { name: /对话图谱/ }));
    expect(screen.getByRole('heading', { name: '对话图谱' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /知识状态/ }));
    expect(screen.getByRole('heading', { name: '当前有效知识' })).toBeInTheDocument();
  });

  it('loads graph pages on demand, keeps earlier nodes, and exposes retryable failures', async () => {
    mocks.getGraphNeighborhood.mockResolvedValueOnce({ graph: { ...projectedGraph().graph, nextCursor: '1:0:1' } });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /对话图谱/ }));
    const more = await screen.findByRole('button', { name: '加载更多' });
    expect(mocks.getGraphNeighborhood).toHaveBeenCalledWith({ nodeLimit: 100, cursor: undefined });
    const next = { ...workspace.discussionNodes[0]!, id: 'next-page', title: '第二页节点' };
    mocks.getGraphNeighborhood.mockResolvedValueOnce(projectedGraph([next]));
    fireEvent.click(more);
    expect(await screen.findByRole('button', { name: '讨论节点：第二页节点' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `讨论节点：${workspace.discussionNodes[0]!.title}` })).toBeInTheDocument();
    expect(mocks.getGraphNeighborhood).toHaveBeenLastCalledWith({ nodeLimit: 100, cursor: '1:0:1' });
    mocks.getGraphNeighborhood.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: '刷新图谱' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('无法加载图谱');
    expect(screen.getByRole('button', { name: '刷新图谱' })).toBeEnabled();
  });

  it('clears graph nodes on workspace switch and discards a late page from the previous scope', async () => {
    const secondId = '00000000-0000-4000-8000-000000000020';
    const late = deferred<ReturnType<typeof projectedGraph>>();
    const nextWorkspace = { ...scopedWorkspace('Second graph'), projectId: secondId };
    mocks.listWorkspaces.mockResolvedValue({ workspaces: [
      { workspaceId: workspace.projectId, name: 'Default', status: 'active' },
      { workspaceId: secondId, name: 'Second', status: 'active' },
    ] });
    mocks.getGraphNeighborhood.mockResolvedValueOnce({ graph: { ...projectedGraph().graph, nextCursor: '1:0:1' } });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /对话图谱/ }));
    const more = await screen.findByRole('button', { name: '加载更多' });
    mocks.getGraphNeighborhood.mockReturnValueOnce(late.promise);
    fireEvent.click(more);
    mocks.getScopedWorkspace.mockResolvedValue({ workspace: nextWorkspace });
    mocks.getGraphNeighborhood.mockResolvedValue(projectedGraph(nextWorkspace.discussionNodes));
    fireEvent.change(screen.getByRole('combobox', { name: '切换工作区' }), { target: { value: secondId } });
    expect(screen.queryByRole('button', { name: `讨论节点：${workspace.discussionNodes[0]!.title}` })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '讨论节点：Second graph' })).toBeInTheDocument();
    late.resolve(projectedGraph());
    await waitFor(() => expect(screen.getByRole('button', { name: '讨论节点：Second graph' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: `讨论节点：${workspace.discussionNodes[0]!.title}` })).not.toBeInTheDocument();
  });

  it('shows committed semantic facts in the Workspace activity timeline', async () => {
    render(<App />);
    const button = await screen.findByRole('button', { name: /活动时间线/ });
    fireEvent.click(button);
    expect(await screen.findByRole('heading', { name: '活动时间线' })).toBeInTheDocument();
    expect(await screen.findByText('完成一次对话')).toBeInTheDocument();
    expect(screen.getByText('conversation.run.committed')).toBeInTheDocument();
    expect(mocks.getWorkspaceActivity).toHaveBeenCalled();
  });

  it('keeps archived nodes out of chat navigation and wires archive restore through the graph', async () => {
    const archived = { ...workspace.discussionNodes[0], id: 'archived-node', title: '已归档讨论', status: 'archived' as const };
    mocks.getWorkspace.mockResolvedValueOnce({ workspace: { ...workspace, discussionNodes: [...workspace.discussionNodes, archived] }, provider: { configured: true, name: 'Test Provider', model: 'test-model', baseUrl: 'https://example.test/v1' }, providerCatalog });
    mocks.getGraphNeighborhood.mockResolvedValueOnce(projectedGraph([...workspace.discussionNodes, archived]));
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: /信息架构方向/ });
    expect(within(document.querySelector('.sidebar') as HTMLElement).queryByText('已归档讨论')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /对话图谱/ }));
    const archiveRegion = screen.getByRole('region', { name: '已归档节点' });
    await waitFor(() => expect(archiveRegion).toHaveTextContent('已归档讨论'));
    fireEvent.click(within(archiveRegion).getByRole('button', { name: '恢复' }));
    await waitFor(() => expect(mocks.restoreGraphNode).toHaveBeenCalledWith('archived-node'));
  });

  it('opens the quick graph without leaving the discussion', async () => {
    render(<App />);
    await screen.findByText('原始回答');
    fireEvent.click(screen.getByRole('button', { name: '快速图谱' }));
    expect(screen.getByLabelText('快速图谱')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /信息架构方向/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开完整图谱' }));
    expect(screen.getByRole('heading', { level: 1, name: '对话图谱' })).toBeInTheDocument();
  });

  it('submits a new discussion turn through the backend', async () => {
    render(<App />);
    await screen.findByRole('button', { name: '选择模型' });
    const input = screen.getByLabelText('输入消息');
    fireEvent.change(input, { target: { value: '验证这个结构' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(screen.getByText('验证这个结构')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('真实 Provider 回答')).toBeInTheDocument());
    expect(mocks.streamMessage).toHaveBeenCalledWith('验证这个结构', expect.any(Function), expect.objectContaining({ operation: 'send', generation: { temperature: 0.4, topP: 1, maxTokens: 2048 } }));
  });

  it('opens provider settings and favorites a model', async () => {
    render(<App />);
    await screen.findByRole('button', { name: '模型与 API 设置' });
    fireEvent.click(screen.getByRole('button', { name: '模型与 API 设置' }));
    expect(await screen.findByRole('dialog', { name: '模型与 API' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '收藏 test-model' }));
    await waitFor(() => expect(mocks.updateModel).toHaveBeenCalledWith('model-1', { favorite: true }));
  });

  it('exposes Regenerate and traceable Edit & Resend actions', async () => {
    render(<App />);
    await screen.findByText('原始回答');
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }));
    await waitFor(() => expect(mocks.streamMessage).toHaveBeenCalledWith('重新生成上一轮回答', expect.any(Function), expect.objectContaining({ operation: 'regenerate', sourceMessageId: 'm2' })));
    fireEvent.click(screen.getAllByRole('button', { name: '编辑并重发' })[0]);
    fireEvent.change(screen.getByLabelText('编辑消息'), { target: { value: '原始问题的新版本' } });
    fireEvent.click(screen.getByRole('button', { name: '发送新版本' }));
    await waitFor(() => expect(mocks.streamMessage).toHaveBeenCalledWith('原始问题的新版本', expect.any(Function), expect.objectContaining({ operation: 'edit-resend', sourceMessageId: 'm1' })));
  });

  it('shows an explicit Retry action after a failed request', async () => {
    mocks.streamMessage.mockRejectedValueOnce(new Error('供应商暂时不可用'));
    render(<App />);
    await screen.findByRole('button', { name: '选择模型' });
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '请重试' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByText('无法完成本轮对话。请重试。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(mocks.streamMessage).toHaveBeenLastCalledWith('请重试', expect.any(Function), expect.objectContaining({ operation: 'send' })));
  });

  it('stops an in-flight generation through AbortSignal', async () => {
    mocks.streamMessage.mockImplementationOnce((_message: string, _onEvent: (event: unknown) => void, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('internal cancellation trace'), { code: 'GENERATION_STOPPED' })), { once: true });
    }));
    render(<App />);
    await screen.findByRole('button', { name: '选择模型' });
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '长回答' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    fireEvent.click(await screen.findByRole('button', { name: '停止生成' }));
    expect(await screen.findByText('已停止接收生成。请查看执行历史，确认状态后重新发送。')).toBeInTheDocument();
    expect(screen.queryByText('长回答', { selector: 'p' })).not.toBeInTheDocument();
  });

  it('uploads, displays and sends an attachment with generation controls', async () => {
    const { container } = render(<App />);
    await screen.findByRole('button', { name: '选择模型' });
    const file = new File(['约束'], 'brief.txt', { type: 'text/plain' });
    fireEvent.change(container.querySelector('.composer input[type="file"]')!, { target: { files: [file] } });
    expect(await screen.findByText('brief.txt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '生成参数' }));
    fireEvent.change(screen.getByLabelText('Temperature'), { target: { value: '0.2' } });
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '总结文件' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(mocks.streamMessage).toHaveBeenCalledWith('总结文件', expect.any(Function), expect.objectContaining({ attachmentIds: ['attachment-1'], generation: expect.objectContaining({ temperature: 0.2 }) })));
  });

  it('keeps a temporary side conversation as a formal branch only on demand', async () => {
    render(<App />);
    await screen.findByText('原始回答');
    fireEvent.click(screen.getByRole('button', { name: '讨论整个段落' }));
    expect(screen.getByLabelText('临时支线')).toBeInTheDocument();
    expect(mocks.createBranch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('临时支线消息'), { target: { value: '为什么？' } });
    fireEvent.click(screen.getByRole('button', { name: '发送临时消息' }));
    expect(await screen.findByText('临时支线回答')).toBeInTheDocument();
    const title = screen.getByLabelText('临时支线标题');
    fireEvent.change(title, { target: { value: '可用性支线' } });
    fireEvent.click(screen.getByRole('button', { name: '保留为讨论流' }));
    await waitFor(() => expect(mocks.createBranch).toHaveBeenCalledWith({ title: '可用性支线', anchorText: '原始回答', sourceMessageId: 'm2', messages: [{ kind: 'user', text: '为什么？', createdAt: '2026-08-09T12:02:00.000Z' }, { kind: 'assistant', text: '临时支线回答', createdAt: '2026-08-09T12:02:01.000Z' }] }));
  });

  it('creates a traceable formal branch directly from a whole message', async () => {
    render(<App />);
    await screen.findByText('原始回答');
    const actions = screen.getAllByRole('button', { name: '创建正式支线' });
    fireEvent.click(actions.at(-1)!);
    await waitFor(() => expect(mocks.createBranch).toHaveBeenCalledWith({ title: '支线：原始回答', anchorText: '原始回答', anchorStart: 0, anchorEnd: 4, sourceMessageId: 'm2' }));
  });

  it('compresses navigation for deeply nested discussion nodes', async () => {
    const deepNodes = [workspace.discussionNodes[0], ...Array.from({ length: 4 }, (_, index) => ({ id: `deep-${index + 1}`, title: `深层讨论 ${index + 1}`, summary: '深层探索', status: 'active' as const, kind: 'branch' as const, sourceNodeId: index === 0 ? 'information-architecture' : `deep-${index}`, x: 400 + index * 50, y: 180 + index * 40, createdAt: `2026-08-09T12:0${index}:00.000Z`, updatedAt: '' }))];
    mocks.getWorkspace.mockResolvedValueOnce({ workspace: { ...workspace, discussionNodes: deepNodes, activeNodeId: 'deep-4', nodeId: 'deep-4' }, provider: { configured: true, name: 'Test Provider', model: 'test-model', baseUrl: 'https://example.test/v1' }, providerCatalog });
    render(<App />);
    expect(await screen.findByText('当前位置 · L5')).toBeInTheDocument();
    expect(screen.getByText('缩进已压缩，使用路径导航避免深层迷失')).toBeInTheDocument();
    expect(await screen.findByTitle('当前位于第 5 层')).toHaveTextContent('L5');
  });

  it('shows loading and recovers from a bootstrap failure', async () => {
    mocks.getWorkspace.mockRejectedValueOnce(new Error('服务不可达'));
    render(<App />);
    expect(screen.getByText('正在加载工作区…')).toBeInTheDocument();
    expect(await screen.findByText('工作区加载失败')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('heading', { level: 1, name: /信息架构方向/ })).toBeInTheDocument();
  });

  it('shows an explicit empty workspace state', async () => {
    mocks.getWorkspace.mockResolvedValueOnce({
      workspace: { ...workspace, discussionNodes: [], messages: [], activeNodeId: '', nodeId: '' },
      provider: { configured: true, name: 'Test Provider', model: 'test-model', baseUrl: 'https://example.test/v1' },
      providerCatalog,
    });
    render(<App />);
    expect(await screen.findByRole('heading', { name: '这个工作区还没有讨论节点' })).toBeInTheDocument();
  });

  it('clears the old scope and never reloads the legacy workspace when a switch fails', async () => {
    const secondWorkspace = '00000000-0000-4000-8000-000000000099';
    mocks.listWorkspaces.mockResolvedValueOnce({ workspaces: [
      { workspaceId: '00000000-0000-4000-8000-000000000001', name: 'Default', status: 'active' },
      { workspaceId: secondWorkspace, name: 'Second', status: 'active' },
    ] });
    mocks.getScopedWorkspace.mockRejectedValueOnce(new Error('scoped load failed'));
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: /信息架构方向/ });
    const select = await screen.findByRole('combobox', { name: '切换工作区' });
    const legacyReads = mocks.getWorkspace.mock.calls.length;
    fireEvent.change(select, { target: { value: secondWorkspace } });
    await waitFor(() => expect(mocks.getScopedWorkspace).toHaveBeenCalledWith(secondWorkspace));
    expect(mocks.setWorkspace).toHaveBeenCalledWith(secondWorkspace);
    expect(mocks.getWorkspace.mock.calls).toHaveLength(legacyReads);
    expect(screen.queryByRole('heading', { level: 1, name: /信息架构方向/ })).not.toBeInTheDocument();
  });

  it('keeps the most recently selected workspace when switch responses resolve out of order', async () => {
    const firstId = '00000000-0000-4000-8000-000000000010';
    const secondId = '00000000-0000-4000-8000-000000000020';
    const first = deferred<{ workspace: typeof workspace }>();
    const second = deferred<{ workspace: typeof workspace }>();
    mocks.listWorkspaces.mockResolvedValueOnce({ workspaces: [
      { workspaceId: '00000000-0000-4000-8000-000000000001', name: 'Default', status: 'active' },
      { workspaceId: firstId, name: 'First', status: 'active' },
      { workspaceId: secondId, name: 'Second', status: 'active' },
    ] });
    mocks.getScopedWorkspace.mockImplementation((id: string) => id === firstId ? first.promise : second.promise);
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: /信息架构方向/ });
    const select = await screen.findByRole('combobox', { name: '切换工作区' });
    fireEvent.change(select, { target: { value: firstId } });
    fireEvent.change(select, { target: { value: secondId } });
    await waitFor(() => expect(mocks.getScopedWorkspace).toHaveBeenCalledWith(secondId));
    second.resolve({ workspace: scopedWorkspace('Second scope') });
    expect(await screen.findByRole('heading', { level: 1, name: /Second scope/ })).toBeInTheDocument();
    first.reject(new Error('first scope failed late'));
    await Promise.resolve();
    expect(screen.getByRole('heading', { level: 1, name: /Second scope/ })).toBeInTheDocument();
  });

  it('does not let a stale default background refresh overwrite a selected workspace', async () => {
    const secondId = '00000000-0000-4000-8000-000000000030';
    const background = deferred<{ workspace: typeof workspace; provider: { configured: boolean; name: string; model: string; baseUrl: string }; providerCatalog: typeof providerCatalog }>();
    const selected = deferred<{ workspace: typeof workspace }>();
    mocks.listWorkspaces.mockResolvedValueOnce({ workspaces: [
      { workspaceId: '00000000-0000-4000-8000-000000000001', name: 'Default', status: 'active' },
      { workspaceId: secondId, name: 'Second', status: 'active' },
    ] });
    mocks.getScopedWorkspace.mockReturnValueOnce(selected.promise);
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: /信息架构方向/ });
    const readsBeforeBackgroundRefresh = mocks.getWorkspace.mock.calls.length;
    mocks.getWorkspace.mockImplementationOnce(() => background.promise);
    fireEvent(window, new Event('online'));
    await waitFor(() => expect(mocks.getWorkspace.mock.calls.length).toBeGreaterThan(readsBeforeBackgroundRefresh));
    const select = await screen.findByRole('combobox', { name: '切换工作区' });
    fireEvent.change(select, { target: { value: secondId } });
    await waitFor(() => expect(mocks.getScopedWorkspace).toHaveBeenCalledWith(secondId));
    selected.resolve({ workspace: scopedWorkspace('Selected scope') });
    expect(await screen.findByRole('heading', { level: 1, name: /Selected scope/ })).toBeInTheDocument();
    background.resolve({ workspace, provider: { configured: true, name: 'Test Provider', model: 'test-model', baseUrl: 'https://example.test/v1' }, providerCatalog });
    await Promise.resolve();
    expect(screen.getByRole('heading', { level: 1, name: /Selected scope/ })).toBeInTheDocument();
  });

  it('keeps archived workspaces selectable and exposes restore after an archive refresh', async () => {
    const id = workspace.projectId;
    mocks.listWorkspaces
      .mockResolvedValueOnce({ workspaces: [{ workspaceId: id, name: 'Default', status: 'active', createdBy: '00000000-0000-4000-8000-000000000002', revision: 1 }] })
      .mockResolvedValueOnce({ workspaces: [{ workspaceId: id, name: 'Default', status: 'archived', createdBy: '00000000-0000-4000-8000-000000000002', revision: 2 }] });
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: /信息架构方向/ });
    fireEvent.click(within(document.querySelector('.project-switch') as HTMLElement).getByRole('button', { name: '归档' }));
    await waitFor(() => expect(mocks.updateWorkspace).toHaveBeenCalledWith(id, 'archive', 1));
    expect(within(document.querySelector('.project-switch') as HTMLElement).getByRole('button', { name: '恢复' })).toBeInTheDocument();
    expect(mocks.listWorkspaces).toHaveBeenCalledWith(true);
  });

  it('refreshes the workspace and disables sending while offline', async () => {
    render(<App />);
    const input = await screen.findByLabelText('输入消息');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    fireEvent(window, new Event('offline'));
    expect(await screen.findByText('当前离线，恢复网络后即可继续发送。')).toBeInTheDocument();
    expect(input).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '讨论整个段落' }));
    expect(screen.getByLabelText('临时支线消息')).toBeDisabled();
    expect(screen.getByRole('button', { name: '发送临时消息' })).toBeDisabled();
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    const callsBeforeReconnect = mocks.getWorkspace.mock.calls.length;
    fireEvent(window, new Event('online'));
    await waitFor(() => expect(mocks.getWorkspace.mock.calls.length).toBeGreaterThan(callsBeforeReconnect));
  });

  it('opens onboarding and command palette from discoverable actions', async () => {
    render(<App />);
    expect(await screen.findByRole('dialog', { name: '欢迎来到 Rhiza' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.queryByRole('dialog', { name: '命令面板' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }));
    fireEvent.click(screen.getByRole('button', { name: /搜索或运行命令/ }));
    expect(screen.getByRole('dialog', { name: '命令面板' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /对话图谱/ }).at(-1)!);
    expect(screen.getByRole('heading', { name: '对话图谱' })).toBeInTheDocument();
  });

  it('supports command shortcuts and preserves graph-chat node synchronization', async () => {
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: /信息架构方向/ });
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }));
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.getByRole('dialog', { name: '命令面板' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '命令面板' })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: '2', metaKey: true });
    expect(screen.getByRole('heading', { name: '对话图谱' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: '1', metaKey: true });
    expect(screen.getByRole('heading', { level: 1, name: /信息架构方向/ })).toBeInTheDocument();
  });

  it('keeps the loaded workspace visible when a reconnect refresh fails', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: /信息架构方向/ })).toBeInTheDocument();
    mocks.getWorkspace.mockRejectedValueOnce(new Error('刷新失败'));
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    fireEvent(window, new Event('online'));
    expect(screen.getByRole('heading', { level: 1, name: /信息架构方向/ })).toBeInTheDocument();
    expect(await screen.findByText('网络已恢复，但工作区刷新失败。')).toBeInTheDocument();
  });
});

it('reuses an unresolved attempt identity after transport loss before RUN_CREATED', async () => {
 const calls=mocks.streamMessage.mock.calls.length;
 mocks.streamMessage.mockRejectedValueOnce(new TypeError('connection lost'));
 render(<App/>);await screen.findByLabelText('输入消息');
 fireEvent.change(screen.getByLabelText('输入消息'),{target:{value:'ambiguous request'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
 await screen.findByRole('button',{name:'重试'});fireEvent.click(screen.getByRole('button',{name:'重试'}));
 await waitFor(()=>expect(mocks.streamMessage).toHaveBeenCalledTimes(calls+2));
 expect(mocks.streamMessage.mock.calls[calls+1]![2].idempotencyKey).toBe(mocks.streamMessage.mock.calls[calls]![2].idempotencyKey);
 expect(mocks.streamMessage.mock.calls[calls+1]![2].operation).toBe('send');
});

it('discards a stale neighborhood after a newer graph refresh',async()=>{
 const late=deferred<ReturnType<typeof projectedGraph>>();const original=projectedGraph();const newer={graph:{...projectedGraph([{...workspace.discussionNodes[0]!,title:'Current title'}]).graph,checkpoint:2}};
 mocks.getGraphNeighborhood.mockImplementation((input:{objectId?:string})=>input.objectId?late.promise:Promise.resolve(original));
 render(<App/>);fireEvent.click(await screen.findByRole('button',{name:'对话图谱'}));await waitFor(()=>expect(mocks.getGraphNeighborhood.mock.calls.some(([input])=>input.objectId)).toBe(true));
 mocks.getGraphNeighborhood.mockImplementation((input:{objectId?:string})=>input.objectId?Promise.resolve(newer):Promise.resolve(newer));
 fireEvent.click(screen.getByRole('button',{name:'刷新图谱'}));await screen.findByRole('button',{name:'讨论节点：Current title'});
 await act(async()=>{late.resolve(original);await late.promise;});expect(screen.queryByRole('button',{name:'讨论节点：信息架构方向'})).not.toBeInTheDocument();
});

it('reconciles an ambiguous completed Chat without sending it again',async()=>{
 const calls=mocks.streamMessage.mock.calls.length;mocks.streamMessage.mockRejectedValueOnce(new TypeError('lost commit'));mocks.findAttemptRun.mockResolvedValue({id:'completed',status:'completed'});
 render(<App/>);await screen.findByLabelText('输入消息');fireEvent.change(screen.getByLabelText('输入消息'),{target:{value:'completed request'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));fireEvent.click(await screen.findByRole('button',{name:'重试'}));await waitFor(()=>expect(screen.queryByRole('button',{name:'重试'})).not.toBeInTheDocument());expect(mocks.streamMessage).toHaveBeenCalledTimes(calls+1);
});

it('preserves IME/Shift+Enter drafts and submits plain Enter with composer focus',async()=>{
 const calls=mocks.streamMessage.mock.calls.length;render(<App/>);const input=await screen.findByLabelText('输入消息');await waitFor(()=>expect(input).toHaveFocus());
 fireEvent.change(input,{target:{value:'keyboard draft'}});fireEvent.keyDown(input,{key:'Enter',isComposing:true});fireEvent.keyDown(input,{key:'Enter',shiftKey:true});expect(mocks.streamMessage).toHaveBeenCalledTimes(calls);expect(input).toHaveValue('keyboard draft');
 fireEvent.keyDown(input,{key:'Enter'});await waitFor(()=>expect(mocks.streamMessage).toHaveBeenCalledTimes(calls+1));
});

it('rejects an old path namespace and preserves the list cursor when merging a current path',async()=>{
 const target={...workspace.discussionNodes[0]!,id:'target',title:'Target',x:540};const list={graph:{...projectedGraph([...workspace.discussionNodes,target]).graph,nextCursor:'list-next'}};
 mocks.getGraphNeighborhood.mockImplementation((input:{objectId?:string})=>Promise.resolve(input.objectId?{graph:{...list.graph,nextCursor:undefined}}:list));
 const late=deferred<typeof list>();mocks.getGraphPath.mockReturnValueOnce(late.promise).mockResolvedValue({graph:{...list.graph,nextCursor:undefined}});
 render(<App/>);fireEvent.click(await screen.findByRole('button',{name:'对话图谱'}));await screen.findByRole('button',{name:'讨论节点：Target'});fireEvent.change(screen.getByLabelText('路径目标'),{target:{value:'target'}});fireEvent.click(screen.getByRole('button',{name:'高亮路径'}));
 await act(async()=>{late.resolve({graph:{...projectedGraph([{...target,title:'Stale path title'}]).graph,version:'old-namespace',nextCursor:'stale-next'}});await late.promise;});expect(screen.queryByRole('button',{name:'讨论节点：Stale path title'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'高亮路径'}));await waitFor(()=>expect(document.querySelectorAll('.path-highlight')).toHaveLength(2));fireEvent.click(screen.getByRole('button',{name:'加载更多'}));await waitFor(()=>expect(mocks.getGraphNeighborhood).toHaveBeenCalledWith(expect.objectContaining({cursor:'list-next'})));
});

const inlineRecord: CollaborationRecord = {
  id: 'inline-review', workspaceId: workspace.projectId, nodeId: 'internal-review', revision: 1, mode: 'second-opinion', participants: ['model-1', 'model-2'], synthesisModelId: 'model-1',
  base: { workspaceId: workspace.projectId, nodeId: workspace.activeNodeId, contextBaseHash: 'a'.repeat(64), prompt: 'Review current discussion', contextItems: [], history: [{ id: 'm2', kind: 'assistant', text: '原始回答' }], attachmentIds: [] },
  status: 'running', createdAt: '2026-10-02T00:00:00Z', attempts: [], budget: { maxRounds: 1, tokenLimit: 32000, synthesisTokens: 1000, usedTokens: 0, reservedTokens: 0, deadlineAt: '2099-10-02T00:00:00Z' },
};
const configureCollaborationModels = () => mocks.getWorkspace.mockResolvedValue({ workspace, provider: { configured: true, name: 'Test Provider', model: 'test-model', baseUrl: 'https://example.test/v1' }, providerCatalog: { ...providerCatalog, models: [...providerCatalog.models, { ...providerCatalog.models[0], id: 'model-2', displayName: 'Second model' }] } });

it('collapses collaboration setup after its input is frozen and keeps the result inside Chat', async () => {
  configureCollaborationModels();
  const stream = deferred<{ collaboration: CollaborationRecord }>();
  mocks.createCollaboration.mockResolvedValue({ collaboration: inlineRecord });
  mocks.streamCollaboration.mockReturnValueOnce(stream.promise);
  render(<App/>);
  fireEvent.click(await screen.findByRole('button', { name: '发起多模型协作' }));
  expect(screen.getByLabelText('协作问题')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '开始协作' }));
  await screen.findByRole('region', { name: '第二意见协作结果' });
  expect(screen.queryByLabelText('协作问题')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: '信息架构方向' })).toBeInTheDocument();
  await act(async () => { stream.resolve({ collaboration: { ...inlineRecord, status: 'canceled' } }); await stream.promise; });
  expect(screen.getByRole('button', { name: '发起多模型协作' })).toBeEnabled();
});

it('does not dispatch or display a collaboration created after switching Workspace', async () => {
  configureCollaborationModels(); mocks.streamCollaboration.mockClear();
  const creation = deferred<{ collaboration: CollaborationRecord }>();
  const otherId = '00000000-0000-4000-8000-000000000020';
  mocks.createCollaboration.mockReturnValueOnce(creation.promise);
  mocks.listWorkspaces.mockResolvedValueOnce({ workspaces: [{ workspaceId: workspace.projectId, name: 'Original', status: 'active' }, { workspaceId: otherId, name: 'Other', status: 'active' }] });
  mocks.getScopedWorkspace.mockResolvedValueOnce({ workspace: { ...scopedWorkspace('Other discussion'), projectId: otherId } });
  render(<App/>);
  fireEvent.click(await screen.findByRole('button', { name: '发起多模型协作' }));
  fireEvent.click(screen.getByRole('button', { name: '开始协作' }));
  fireEvent.change(screen.getByRole('combobox', { name: '切换工作区' }), { target: { value: otherId } });
  await screen.findByRole('heading', { level: 1, name: 'Other discussion' });
  await act(async () => { creation.resolve({ collaboration: inlineRecord }); await creation.promise; });
  expect(mocks.streamCollaboration).not.toHaveBeenCalled();
  expect(screen.queryByRole('region', { name: '第二意见协作结果' })).not.toBeInTheDocument();
});
