import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Attachment, ContextManifest, ContextMode, ContextStatus, DiscussionEdge, DiscussionNode, GraphProjectionResult, Message, ProviderCatalog, ProviderPresetInfo, ProviderStatus, Segment, View, WorkspaceActivityItem, WorkspaceSnapshot, WorkspaceRecord } from './types';
import { api, type ChatRequestOptions } from './api';
import { presentErrorText } from './error-presentation';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { GraphView } from './components/GraphView';
import { StateView } from './components/StateView';
import { ContextPanel } from './components/ContextPanel';
import { ProviderSettings, type ProviderFormState } from './components/ProviderSettings';
import { RunHistory } from './components/RunHistory';
import { ActivityView } from './components/ActivityView';
import { AppShell } from './components/AppShell';
import { projectionToGraphPresentationModel, toGraphPresentationModel } from './components/graph-model';

export function App() {
  const initialNode: DiscussionNode = { id: 'information-architecture', title: '信息架构方向', summary: '探索首屏的内容层级、上下文入口与专业能力的渐进呈现方式。', status: 'active', kind: 'main', x: 350, y: 150, createdAt: '2026-08-09T12:00:00.000Z', updatedAt: '2026-08-09T12:00:00.000Z' };
  const [view, setView] = useState<View>('chat');
  const [contextItems, setContextItems] = useState<WorkspaceSnapshot['contextItems']>([]);
  const [mode, setMode] = useState<ContextMode>('Assisted');
  const [messages, setMessages] = useState<Message[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [discussionNodes, setDiscussionNodes] = useState<DiscussionNode[]>([]);
  const [discussionEdges, setDiscussionEdges] = useState<DiscussionEdge[]>([]);
  const [activeNodeId, setActiveNodeId] = useState('');
  const [provider, setProvider] = useState<ProviderStatus>({ configured: false, name: 'OpenAI-compatible', model: '未配置', baseUrl: '' });
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalog>({ providers: [], models: [], activeModelId: null });
  const [providerPresets, setProviderPresets] = useState<Record<string, ProviderPresetInfo>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [contextOpen, setContextOpen] = useState(false);
  const [manifests, setManifests] = useState<ContextManifest[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [boot, setBoot] = useState<'loading' | 'ready' | 'error'>('loading');
  const [bootError, setBootError] = useState('');
  const [online, setOnline] = useState(() => navigator.onLine);
  const [networkNotice, setNetworkNotice] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(() => localStorage.getItem('rhiza:onboarding-seen') !== '1');
  const [focusComposerRequest, setFocusComposerRequest] = useState(0);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string>();
  const [activity, setActivity] = useState<WorkspaceActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState('');
  const [graphProjection, setGraphProjection] = useState<GraphProjectionResult>();
  const workspaceGenerationRef = useRef(0);
  const selectedWorkspaceRef = useRef<string | undefined>(undefined);
  const modalReturnFocusRef = useRef<HTMLElement | null>(null);
  const activeModalRef = useRef<HTMLElement | null>(null);

  const applyWorkspace = useCallback((workspace: WorkspaceSnapshot) => {
    setContextItems(workspace.contextItems);
    setMessages(workspace.messages);
    setAttachments(workspace.attachments || []);
    setMode(workspace.mode);
    setDiscussionNodes(workspace.discussionNodes);
    setDiscussionEdges(workspace.discussionEdges);
    setGraphProjection(undefined);
    setActiveNodeId(workspace.activeNodeId);
    setManifests(workspace.manifests || []);
    setSegments(workspace.segments || []);
  }, []);

  const workspaceMutation = () => {
    const workspaceId = selectedWorkspaceRef.current;
    const generation = workspaceGenerationRef.current;
    return () => generation === workspaceGenerationRef.current && workspaceId === selectedWorkspaceRef.current;
  };

  const loadWorkspace = useCallback(async (background = false) => {
    const workspaceId = selectedWorkspaceRef.current;
    const generation = ++workspaceGenerationRef.current;
    if (!background) setBoot('loading');
    try {
      const { workspace, provider: providerStatus, providerCatalog: catalog } = await api.getWorkspace();
      if (generation !== workspaceGenerationRef.current || workspaceId !== selectedWorkspaceRef.current) return 'stale' as const;
      if (!workspaceId) {
        selectedWorkspaceRef.current = workspace.projectId;
        api.setWorkspace(workspace.projectId);
        setCurrentWorkspaceId(workspace.projectId);
      }
      applyWorkspace(workspace);
      setProvider(providerStatus);
      setProviderCatalog(catalog);
      setSyncError('');
      setBoot('ready'); setBootError('');
      return 'loaded' as const;
    } catch (error) {
      if (generation !== workspaceGenerationRef.current || workspaceId !== selectedWorkspaceRef.current) return 'stale' as const;
      const message = presentErrorText(error, { message: '无法加载工作区。', recovery: '请检查网络后重试。' });
      if (!background) { setBoot('error'); setBootError(message); }
      setSyncError(message);
      return 'failed' as const;
    }
  }, [applyWorkspace]);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);
  const loadActivity = useCallback(async () => {
    const workspaceId = selectedWorkspaceRef.current;
    const generation = workspaceGenerationRef.current;
    setActivityLoading(true);
    try {
      const result = await api.getWorkspaceActivity();
      if (generation !== workspaceGenerationRef.current || workspaceId !== selectedWorkspaceRef.current) return;
      setActivity(result.activity); setActivityError('');
    } catch (error) {
      if (generation === workspaceGenerationRef.current && workspaceId === selectedWorkspaceRef.current) setActivityError(presentErrorText(error, { message: '无法加载活动时间线。', recovery: '请稍后重试。' }));
    } finally {
      if (generation === workspaceGenerationRef.current && workspaceId === selectedWorkspaceRef.current) setActivityLoading(false);
    }
  }, []);
  useEffect(() => { if (view === 'activity' && boot === 'ready') void loadActivity(); }, [view, boot, currentWorkspaceId, loadActivity]);
  const loadGraph = useCallback(async () => {
    const workspaceId = selectedWorkspaceRef.current; const generation = workspaceGenerationRef.current;
    try {
      const { graph } = await api.getGraphNeighborhood();
      if (generation === workspaceGenerationRef.current && workspaceId === selectedWorkspaceRef.current) setGraphProjection(graph);
    } catch (error) {
      if (generation === workspaceGenerationRef.current && workspaceId === selectedWorkspaceRef.current) setSyncError(presentErrorText(error, { message: '无法加载图谱投影。', recovery: '请稍后重试。' }));
    }
  }, []);
  useEffect(() => { if (view === 'graph' && boot === 'ready') void loadGraph(); }, [view, boot, currentWorkspaceId, discussionNodes, loadGraph]);
  useEffect(() => { if (api.listWorkspaces) void api.listWorkspaces(true).then(result => setWorkspaces(result.workspaces)).catch(() => undefined); }, []);
  const switchWorkspace = async (workspaceId: string) => {
    const generation = ++workspaceGenerationRef.current;
    selectedWorkspaceRef.current = workspaceId;
    setMessages([]); setDiscussionNodes([]); setContextItems([]); setAttachments([]); setDiscussionEdges([]); setSegments([]); setManifests([]); setActivity([]); setActiveNodeId('');
    api.setWorkspace(workspaceId); setCurrentWorkspaceId(workspaceId);
    try {
      const { workspace } = await api.getScopedWorkspace(workspaceId);
      if (generation !== workspaceGenerationRef.current || workspaceId !== selectedWorkspaceRef.current) return;
      applyWorkspace(workspace); setSyncError('');
    } catch (error) {
      if (generation !== workspaceGenerationRef.current || workspaceId !== selectedWorkspaceRef.current) return;
      setSyncError(presentErrorText(error, { message: '无法加载所选工作区。', recovery: '请检查网络后重试。' }));
    }
  };
  const refreshWorkspaces = async () => { const items = (await api.listWorkspaces(true)).workspaces; setWorkspaces(items); return items; };
  const createWorkspace = async () => { const current = workspaceMutation(); const name = window.prompt('工作区名称'); if (!name?.trim()) return; const { workspace } = await api.createWorkspace(name.trim()); if (!current()) return; await refreshWorkspaces(); if (current()) await switchWorkspace(workspace.workspaceId); };
  const workspaceRecord = () => workspaces.find(item => item.workspaceId === currentWorkspaceId);
  const renameWorkspace = async () => { const current = workspaceMutation(); const record = workspaceRecord(); const name = window.prompt('新名称', record?.name); if (!name?.trim() || !record) return; await api.updateWorkspace(record.workspaceId, 'rename', record.revision, name.trim()); if (current()) await refreshWorkspaces(); };
  const archiveWorkspace = async () => { const current = workspaceMutation(); const record = workspaceRecord(); if (!record) return; await api.updateWorkspace(record.workspaceId, 'archive', record.revision); if (!current()) return; const items = await refreshWorkspaces(); if (!current()) return; const next = items.find(item => item.workspaceId !== record.workspaceId && item.status === 'active'); if (next) await switchWorkspace(next.workspaceId); };
  const restoreWorkspace = async () => { const current = workspaceMutation(); const record = workspaceRecord(); if (!record) return; await api.updateWorkspace(record.workspaceId, 'restore', record.revision); if (current()) await refreshWorkspaces(); };
  useEffect(() => {
    const goOffline = () => { setOnline(false); setNetworkNotice('当前离线，发送已暂停。'); };
    const goOnline = () => {
      setOnline(true);
      setNetworkNotice('网络已恢复，正在刷新工作区。');
      void loadWorkspace(boot === 'ready').then(result => {
        if (result !== 'stale') setNetworkNotice(result === 'loaded' ? '网络已恢复，工作区已刷新。' : '网络已恢复，但工作区刷新失败。');
      });
    };
    window.addEventListener('offline', goOffline); window.addEventListener('online', goOnline);
    return () => { window.removeEventListener('offline', goOffline); window.removeEventListener('online', goOnline); };
  }, [boot, loadWorkspace]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (onboardingOpen) {
        if (event.key === 'Escape') { localStorage.setItem('rhiza:onboarding-seen', '1'); setOnboardingOpen(false); }
        return;
      }
      if (paletteOpen) {
        if (event.key === 'Escape') setPaletteOpen(false);
        return;
      }
      if (settingsOpen) {
        if (event.key === 'Escape') setSettingsOpen(false);
        return;
      }
      if (event.key === 'Escape') { setPaletteOpen(false); setContextOpen(false); setSettingsOpen(false); return; }
      if (modifier && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen(true); return; }
      if (modifier && event.key === '1') { event.preventDefault(); setView('chat'); }
      if (modifier && event.key === '2') { event.preventDefault(); setView('graph'); }
      if (modifier && event.key === '3') { event.preventDefault(); setView('state'); }
      if (modifier && event.key === '4') { event.preventDefault(); setView('activity'); }
      if (modifier && event.shiftKey && event.key.toLowerCase() === 'c') { event.preventDefault(); setContextOpen(true); }
      if (event.key === '/' && !modifier && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); setView('chat'); setFocusComposerRequest(value => value + 1); }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [onboardingOpen, paletteOpen, settingsOpen]);
  useEffect(() => {
    if (!paletteOpen && !onboardingOpen) return;
    modalReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = activeModalRef.current;
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])];
    const first = focusable()[0];
    first?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = focusable();
      if (!controls.length) return;
      const firstControl = controls[0]; const lastControl = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === firstControl) { event.preventDefault(); lastControl.focus(); }
      else if (!event.shiftKey && document.activeElement === lastControl) { event.preventDefault(); firstControl.focus(); }
    };
    document.addEventListener('keydown', trapFocus);
    return () => { document.removeEventListener('keydown', trapFocus); modalReturnFocusRef.current?.focus(); };
  }, [onboardingOpen, paletteOpen]);

  const applyCatalog = (catalog: ProviderCatalog) => {
    setProviderCatalog(catalog);
    const activeModel = catalog.models.find(model => model.id === catalog.activeModelId);
    const activeProvider = catalog.providers.find(item => item.id === activeModel?.providerId);
    setProvider({ configured: Boolean(activeModel && activeProvider?.configured), name: activeProvider?.name || '未配置供应商', model: activeModel?.displayName || '未选择模型', baseUrl: activeProvider?.baseUrl || '' });
  };

  const openSettings = async () => {
    setSettingsOpen(true);
    try {
      const { catalog, presets } = await api.getProviders();
      applyCatalog(catalog);
      setProviderPresets(presets);
    } catch (error) { setSyncError(presentErrorText(error, { message: '无法加载模型配置。', recovery: '请稍后重试。' })); }
  };

  const saveProvider = async (form: ProviderFormState) => {
    const { catalog } = await api.saveProvider(form);
    applyCatalog(catalog);
  };
  const discoverModels = async (providerId: string) => { const { catalog } = await api.discoverModels(providerId); applyCatalog(catalog); };
  const updateModel = async (modelId: string, changes: { favorite?: boolean; pinned?: boolean }) => { const { catalog } = await api.updateModel(modelId, changes); applyCatalog(catalog); };
  const selectModel = async (modelId: string) => { const result = await api.selectModel(modelId); setProviderCatalog(result.catalog); setProvider(result.provider); };

  const updateStatus = async (id: string, status: ContextStatus) => {
    const current = workspaceMutation();
    const previous = contextItems;
    setContextItems(items => items.map(item => item.id === id ? { ...item, status } : item));
    try {
      const { workspace } = await api.setContextStatus(id, status);
      if (!current()) return;
      setContextItems(workspace.contextItems);
      setSyncError('');
    } catch (error) {
      if (!current()) return;
      setContextItems(previous);
      setSyncError(presentErrorText(error, { message: '无法保存 Context。', recovery: '请稍后重试。' }));
    }
  };

  const updateMode = async (nextMode: ContextMode) => {
    const current = workspaceMutation();
    const previous = mode;
    setMode(nextMode);
    try {
      await api.setMode(nextMode);
      if (!current()) return;
      setSyncError('');
    } catch (error) {
      if (!current()) return;
      setMode(previous);
      setSyncError(presentErrorText(error, { message: '无法保存模式。', recovery: '请稍后重试。' }));
    }
  };

  const updatePin = async (id: string, pinned: boolean) => {
    const current = workspaceMutation();
    const previous = contextItems;
    setContextItems(items => items.map(item => item.id === id ? { ...item, pinned, ...(pinned ? { status: 'active' as const } : {}) } : item));
    try {
      const { workspace } = await api.setContextPin(id, pinned);
      if (!current()) return;
      setContextItems(workspace.contextItems);
      setSyncError('');
    } catch (error) {
      if (!current()) return;
      setContextItems(previous);
      setSyncError(presentErrorText(error, { message: '无法保存固定状态。', recovery: '请稍后重试。' }));
    }
  };

  const addContextSource = async (sourceType: 'node' | 'segment' | 'file', sourceId: string) => {
    const current = workspaceMutation();
    try {
      const { workspace } = await api.addContextSource(sourceType, sourceId);
      if (!current()) return;
      setContextItems(workspace.contextItems);
      setSyncError('');
    } catch (error) { if (current()) setSyncError(presentErrorText(error, { message: '无法添加 Context 来源。', recovery: '请稍后重试。' })); }
  };

  const sendMessage = async (text: string, options: ChatRequestOptions = {}) => {
    const current = workspaceMutation();
    const pendingId = `pending-${Date.now()}`;
    const pendingAssistantId = `${pendingId}-assistant`;
    const pending: Message = { id: pendingId, nodeId: activeNodeId, kind: 'user', text, createdAt: new Date().toISOString(), pending: true, attachmentIds: options.attachmentIds, operation: options.operation };
    const pendingAssistant: Message = { id: pendingAssistantId, nodeId: activeNodeId, kind: 'assistant', text: '', createdAt: new Date().toISOString(), pending: true, operation: options.operation };
    setMessages(current => [...current, pending]);
    try {
      const result = await api.streamMessage(text, event => {
        if (!current()) return;
        if (!['CONTENT_DELTA', 'REASONING_DELTA', 'TOOL_CALL_DELTA', 'USAGE'].includes(event.type)) return;
        setMessages(current => {
          const existing = current.find(message => message.id === pendingAssistantId) || pendingAssistant;
          let next = existing;
          if (event.type === 'CONTENT_DELTA') next = { ...existing, text: existing.text + event.delta };
          if (event.type === 'REASONING_DELTA') next = { ...existing, reasoning: (existing.reasoning || '') + event.delta };
          if (event.type === 'TOOL_CALL_DELTA') next = { ...existing, toolCalls: [...(existing.toolCalls || []).filter(tool => tool.id !== event.toolCall.id), event.toolCall] };
          if (event.type === 'USAGE') next = { ...existing, usage: event.usage };
          return current.some(message => message.id === pendingAssistantId) ? current.map(message => message.id === pendingAssistantId ? next : message) : [...current, next];
        });
      }, options);
      if (!current()) return;
      setMessages(current => [...current.filter(message => message.id !== pendingId && message.id !== pendingAssistantId), result.userMessage, result.assistantMessage]);
      setManifests(current => current.some(manifest => manifest.id === result.manifest.id) ? current : [...current, result.manifest]);
      setSyncError('');
    } catch (error) {
      if (!current()) return;
      setMessages(current => current.filter(message => message.id !== pendingAssistantId && message.id !== pendingId));
      throw error;
    }
  };
  const uploadAttachment = async (file: File) => {
    const current = workspaceMutation();
    const attachment = await api.uploadAttachment(file);
    if (!current()) return attachment;
    setAttachments(current => current.some(item => item.id === attachment.id) ? current : [...current, attachment]);
    return attachment;
  };
  const createBranch = async (input: { title: string; anchorText?: string; anchorStart?: number; anchorEnd?: number; sourceMessageId?: string; messages?: Array<Pick<Message, 'kind' | 'text' | 'createdAt'>> }) => {
    const current = workspaceMutation();
    const { workspace } = await api.createBranch(input);
    if (!current()) return;
    applyWorkspace(workspace);
    setView('chat');
    setSyncError('');
  };
  const sendTemporaryMessage = async (input: { sourceNodeId: string; anchorText: string; message: string; history: Array<Pick<Message, 'kind' | 'text'>> }) => api.sendTemporaryMessage(input);
  const activateNode = async (id: string, openChat = false) => {
    const current = workspaceMutation();
    const { workspace } = await api.activateNode(id);
    if (!current()) return;
    applyWorkspace(workspace);
    if (openChat) setView('chat');
  };
  const moveNode = async (id: string, x: number, y: number) => {
    const current = workspaceMutation();
    const previous = discussionNodes;
    setDiscussionNodes(nodes => nodes.map(node => node.id === id ? { ...node, x, y } : node));
    try {
      const { workspace } = await api.moveNode(id, x, y);
      if (!current()) return;
      applyWorkspace(workspace);
    } catch (error) {
      if (!current()) return;
      setDiscussionNodes(previous);
      setSyncError(presentErrorText(error, { message: '无法保存节点位置。', recovery: '请稍后重试。' }));
    }
  };
  const createGraphNode = async (input: { title: string; summary?: string; x: number; y: number }) => {
    const current = workspaceMutation();
    const { workspace } = await api.createGraphNode(input);
    if (!current()) return;
    applyWorkspace(workspace);
    setSyncError('');
  };
  const archiveGraphNode = async (id: string) => {
    const current = workspaceMutation();
    const { workspace } = await api.archiveGraphNode(id);
    if (!current()) return;
    applyWorkspace(workspace);
    setSyncError('');
  };
  const restoreGraphNode = async (id: string) => {
    const current = workspaceMutation();
    const { workspace } = await api.restoreGraphNode(id);
    if (!current()) return;
    applyWorkspace(workspace);
    setSyncError('');
  };
  const createGraphEdge = async (input: { source: string; target: string; relation: 'derived-from' | 'references' | 'related-to' | 'merged-into'; label: string }) => {
    const current = workspaceMutation();
    const { workspace } = await api.createGraphEdge(input);
    if (!current()) return;
    applyWorkspace(workspace);
    setSyncError('');
  };
  const deleteGraphEdge = async (id: string) => {
    const current = workspaceMutation();
    const { workspace } = await api.deleteGraphEdge(id);
    if (!current()) return;
    applyWorkspace(workspace);
    setSyncError('');
  };
  const mergeNode = async (id: string) => {
    const current = workspaceMutation();
    const { workspace } = await api.mergeNode(id);
    if (!current()) return;
    applyWorkspace(workspace);
    setView('chat');
  };
  const activeCount = contextItems.filter(item => item.status === 'active').length;
  const navigableNodes = discussionNodes.filter(node => node.status !== 'archived');
  const activeNode = navigableNodes.find(node => node.id === activeNodeId) || navigableNodes[0] || initialNode;
  const activeMessages = messages.filter(message => message.nodeId === activeNode.id);
  const graphModel = useMemo(
    () => graphProjection ? projectionToGraphPresentationModel(graphProjection) : toGraphPresentationModel([], []),
    [graphProjection],
  );

  if (boot === 'loading') return <main className="app-loading" aria-busy="true" aria-live="polite"><strong>正在加载工作区…</strong><p>正在同步项目、讨论节点与上下文。</p></main>;
  if (boot === 'error') return <main className="app-loading" role="alert"><strong>工作区加载失败</strong><p>{bootError}</p><button className="primary-button" onClick={() => void loadWorkspace()}>重试</button></main>;

  const closeOnboarding = () => { localStorage.setItem('rhiza:onboarding-seen', '1'); setOnboardingOpen(false); };
  const runCommand = (action: () => void) => { setPaletteOpen(false); action(); };

  return <AppShell
    view={view}
    hasDiscussionNodes={discussionNodes.length > 0}
    contextOpen={contextOpen}
    networkNotice={networkNotice}
    onCloseContext={() => setContextOpen(false)}
    sidebar={<Sidebar view={view} nodes={navigableNodes} messages={messages} activeNodeId={activeNode.id} onView={setView} onNode={id => activateNode(id, true)} onSettings={openSettings} onCommand={() => setPaletteOpen(true)} onHelp={() => setOnboardingOpen(true)} workspaces={workspaces} currentWorkspaceId={currentWorkspaceId} onWorkspace={id => void switchWorkspace(id)} onCreateWorkspace={() => void createWorkspace()} onRenameWorkspace={() => void renameWorkspace()} onArchiveWorkspace={() => void archiveWorkspace()} onRestoreWorkspace={() => void restoreWorkspace()}/>}
    emptySurface={<main id="workspace-main" className="workspace-empty"><h1>这个工作区还没有讨论节点</h1><p>请通过项目入口创建第一个节点，然后开始建立上下文。</p></main>}
    surfaces={{
      chat: <ChatView
        activeNode={activeNode} nodes={navigableNodes} edges={discussionEdges} mode={mode}
        activeCount={activeCount} messages={activeMessages} manifests={manifests} attachments={attachments}
        provider={provider} providerCatalog={providerCatalog} syncError={syncError} online={online} focusComposerRequest={focusComposerRequest} onSend={sendMessage}
        onUpload={uploadAttachment} onTempSend={sendTemporaryMessage} onCreateBranch={createBranch}
        onActivateNode={id => activateNode(id, true)} onMerge={mergeNode} onSelectModel={selectModel}
        onSettings={openSettings} onOpenContext={() => setContextOpen(open => !open)} onGraph={() => setView('graph')} onRuns={() => setView('runs')}
      />,
      graph: <GraphView nodes={graphModel.nodes} edges={graphModel.edges} activeNodeId={activeNode.id} onMove={moveNode} onActivate={id => activateNode(id, true)} onCreateNode={createGraphNode} onArchiveNode={archiveGraphNode} onRestoreNode={restoreGraphNode} onCreateEdge={createGraphEdge} onDeleteEdge={deleteGraphEdge}/>,
      state: <StateView/>,
      runs: <RunHistory key={currentWorkspaceId} onChanged={() => void loadWorkspace(true)}/>,
      activity: <ActivityView activity={activity} loading={activityLoading} error={activityError} onRefresh={() => void loadActivity()}/>,
    }}
    contextSurface={<ContextPanel items={contextItems} mode={mode} nodes={discussionNodes} segments={segments} attachments={attachments} onMode={updateMode} onStatus={updateStatus} onPin={updatePin} onAddSource={addContextSource}/>}
    overlayLayer={<>
      {settingsOpen && <ProviderSettings catalog={providerCatalog} presets={providerPresets} onClose={() => setSettingsOpen(false)} onSave={saveProvider} onDiscover={discoverModels} onToggleModel={updateModel} onSelectModel={selectModel}/>}
      {paletteOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPaletteOpen(false); }}><section ref={activeModalRef} className="command-palette" role="dialog" aria-modal="true" aria-label="命令面板"><header><strong>搜索或运行命令</strong><kbd>Esc</kbd></header><button onClick={() => runCommand(() => setView('chat'))}>当前讨论 <kbd>⌘1</kbd></button><button onClick={() => runCommand(() => setView('graph'))}>对话图谱 <kbd>⌘2</kbd></button><button onClick={() => runCommand(() => setView('state'))}>知识状态 <kbd>⌘3</kbd></button><button onClick={() => runCommand(() => setView('activity'))}>活动时间线 <kbd>⌘4</kbd></button><button onClick={() => runCommand(() => setContextOpen(true))}>打开 Context <kbd>⌘⇧C</kbd></button><button onClick={() => runCommand(() => { setView('chat'); setFocusComposerRequest(value => value + 1); })}>聚焦消息输入框 <kbd>/</kbd></button><button onClick={() => runCommand(() => setOnboardingOpen(true))}>帮助与快捷键</button></section></div>}
      {onboardingOpen && <div className="dialog-backdrop" role="presentation"><section ref={activeModalRef} className="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title"><h2 id="onboarding-title">欢迎来到 Rhiza</h2><p>用四个对象把研究和决策留在同一个工作区：</p><dl><div><dt>Project</dt><dd>一个完整的研究或决策空间。</dd></div><div><dt>Node</dt><dd>围绕一个问题持续展开的讨论。</dd></div><div><dt>Graph</dt><dd>展示讨论之间的衍生、引用和合并关系。</dd></div><div><dt>Context</dt><dd>明确控制本轮发送给模型的材料。</dd></div></dl><button className="primary-button" autoFocus onClick={closeOnboarding}>开始使用</button></section></div>}
    </>}
  />;
}
