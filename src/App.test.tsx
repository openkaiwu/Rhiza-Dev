// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from './App';
import { initialContext } from './data';
import type { ContextManifest, Message } from './types';

const mocks = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
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
  sendTemporaryMessage: vi.fn(),
  setWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
  getScopedWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
}));

vi.mock('./api', () => ({ api: mocks }));

const workspace = {
  projectId: 'rhiza-product-research', nodeId: 'information-architecture', mode: 'Assisted' as const,
  contextItems: initialContext,
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

beforeEach(() => {
  localStorage.clear();
  mocks.getWorkspace.mockResolvedValue({ workspace, provider: { configured: true, name: 'Test Provider', model: 'test-model', baseUrl: 'https://example.test/v1' }, providerCatalog });
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
  it('opens with the focused discussion experience', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: /信息架构方向/ })).toBeInTheDocument();
    expect(screen.getByText('本轮上下文')).toBeInTheDocument();
    expect(screen.getByText('根系')).toBeInTheDocument();
    expect(screen.getByText('Rhiza')).toBeInTheDocument();
    expect(screen.getByText('Recommended · 待确认')).toBeInTheDocument();
    expect(screen.getByText('推荐项不会自动进入模型输入。')).toBeInTheDocument();
  });

  it('binds the configured default returned by the legacy bootstrap before later workspace requests', async () => {
    const customDefault = 'custom-default-workspace';
    const readsBeforeBoot = mocks.getWorkspace.mock.calls.length;
    mocks.getWorkspace.mockResolvedValueOnce({ workspace: { ...workspace, projectId: customDefault }, provider: { configured: true, name: 'Test Provider', model: 'test-model', baseUrl: 'https://example.test/v1' }, providerCatalog });
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: /信息架构方向/ });
    expect(mocks.getWorkspace).toHaveBeenCalledTimes(readsBeforeBoot + 1);
    expect(mocks.setWorkspace).toHaveBeenCalledWith(customDefault);
    fireEvent.click(screen.getByRole('button', { name: '加入' }));
    await waitFor(() => expect(mocks.setContextStatus).toHaveBeenCalledWith('c3', 'active'));
  });

  it('moves recommended context into active context', async () => {
    render(<App />);
    expect(await screen.findByText('2 项上下文')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加入' }));
    expect(screen.getByText('3 项上下文')).toBeInTheDocument();
    await waitFor(() => expect(mocks.setContextStatus).toHaveBeenCalledWith('c3', 'active'));
  });

  it('ignores a late workspace mutation after switching to another workspace', async () => {
    const delayed = deferred<{ workspace: typeof workspace }>();
    const workspaceB = { ...scopedWorkspace('Workspace B'), projectId: 'workspace-b', contextItems: [] };
    mocks.listWorkspaces.mockResolvedValue({ workspaces: [
      { workspaceId: workspace.projectId, name: 'Workspace A', status: 'active', createdBy: 'local', revision: 1 },
      { workspaceId: 'workspace-b', name: 'Workspace B', status: 'active', createdBy: 'local', revision: 1 },
    ] });
    mocks.setContextStatus.mockReturnValueOnce(delayed.promise);
    mocks.getScopedWorkspace.mockResolvedValueOnce({ workspace: workspaceB });
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: /信息架构方向/ });
    await waitFor(() => expect(screen.getByLabelText('切换工作区')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '加入' }));
    fireEvent.change(screen.getByLabelText('切换工作区'), { target: { value: 'workspace-b' } });
    await screen.findByRole('heading', { level: 1, name: /Workspace B/ });
    delayed.resolve({ workspace: { ...workspace, contextItems: [...workspace.contextItems, { ...workspace.contextItems[0], id: 'late-a' }] } });
    await waitFor(() => expect(screen.queryByText('3 项上下文')).not.toBeInTheDocument());
    expect(screen.getByText('0 项上下文')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /Workspace B/ })).toBeInTheDocument();
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
    fireEvent.click(screen.getAllByRole('button', { name: /固定/ })[0]);
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

  it('keeps archived nodes out of chat navigation and wires archive restore through the graph', async () => {
    const archived = { ...workspace.discussionNodes[0], id: 'archived-node', title: '已归档讨论', status: 'archived' as const };
    mocks.getWorkspace.mockResolvedValueOnce({ workspace: { ...workspace, discussionNodes: [...workspace.discussionNodes, archived] }, provider: { configured: true, name: 'Test Provider', model: 'test-model', baseUrl: 'https://example.test/v1' }, providerCatalog });
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: /信息架构方向/ });
    expect(within(document.querySelector('.sidebar') as HTMLElement).queryByText('已归档讨论')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /对话图谱/ }));
    const archiveRegion = screen.getByRole('region', { name: '已归档节点' });
    expect(archiveRegion).toHaveTextContent('已归档讨论');
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
    await screen.findByText(/test-model/);
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
    await screen.findByText(/test-model/);
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '请重试' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByText('无法完成本轮对话。请重试。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(mocks.streamMessage).toHaveBeenLastCalledWith('请重试', expect.any(Function), expect.objectContaining({ operation: 'retry' })));
  });

  it('stops an in-flight generation through AbortSignal', async () => {
    mocks.streamMessage.mockImplementationOnce((_message: string, _onEvent: (event: unknown) => void, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('internal cancellation trace'), { code: 'GENERATION_STOPPED' })), { once: true });
    }));
    render(<App />);
    await screen.findByText(/test-model/);
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '长回答' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    fireEvent.click(await screen.findByRole('button', { name: '停止生成' }));
    expect(await screen.findByText('生成已停止，本轮未写入历史。可以修改输入后重新发送。')).toBeInTheDocument();
    expect(screen.queryByText('长回答', { selector: 'p' })).not.toBeInTheDocument();
  });

  it('uploads, displays and sends an attachment with generation controls', async () => {
    const { container } = render(<App />);
    await screen.findByText(/test-model/);
    const file = new File(['约束'], 'brief.txt', { type: 'text/plain' });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
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
