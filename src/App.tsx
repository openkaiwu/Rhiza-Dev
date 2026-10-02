import { formatLocation, parseLocation, useWorkspaceNavigation, viewLocation, type WorkspaceLocation } from './navigation';
import { BundleControls } from './components/BundleControls';
import { WorkspaceForm } from './components/WorkspaceForm';
import { WorkspaceSearch } from './components/WorkspaceSearch';
import { MergeDialog } from './components/MergeDialog';
import { boundedGraphCache } from './components/graph-viewport';
import { GraphContextTray } from './components/GraphContextTray';
import type { ContextSelectionPreview, ContextSourceRef } from './types';
import type { GraphDisplayFilters } from './navigation';
import type { GraphNodeModel } from './components/graph-model';
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type { Anchor, Attachment, ContextManifest, ContextMode, ContextPreview, ContextRecommendationDecision, CollaborationInput, CollaborationRecord, ContextStatus, ExecutionRun, DiscussionEdge, DiscussionNode, GraphProjectionResult, Message, GraphBatchItem, GraphBatchResult, GraphViewInput, PersonalGraphView, ManagedBackupList, ProviderCatalog, ProviderPresetInfo, ProviderStatus, Segment, View, WorkspaceActivityItem, WorkspaceSnapshot, WorkspaceRecord } from './types';
import { api, type ChatRequestOptions } from './api';
import { presentErrorText } from './error-presentation';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { GraphView, type GraphNavigationPresentation } from './components/GraphView';
import { StateView } from './components/StateView';
import { ResourceView } from './components/ResourceView';
import type { ContextHistoryState } from './components/ContextHistoryPanel';
import { ContextPanel } from './components/ContextPanel';
import { ProviderSettings, type ProviderFormState } from './components/ProviderSettings';
import { RunHistory } from './components/RunHistory';
import { ActivityView } from './components/ActivityView';
import { AppShell } from './components/AppShell';
import { projectionToGraphPresentationModel, toGraphPresentationModel, toGraphPersonalPresentation, type GraphPersonalPresentation, type GraphRelation } from './components/graph-model';

export function App() {
  const { location, navigate: navigationNavigate, close: navigationClose, record: navigationRecord, forget: navigationForget, entryKey: navigationEntryKey, recents: navigationRecents, restoration: navigationRestoration, rememberGraph: navigationRememberGraph, canBack: navigationCanBack } = useWorkspaceNavigation();
  const initialNode: DiscussionNode = { id: '', title: '尚无讨论', summary: '', status: 'active', kind: 'main', x: 0, y: 0, createdAt: '', updatedAt: '' };
  const [loadedWorkspaceId, setLoadedWorkspaceId] = useState<string>();
  const [routeGraphObject, setRouteGraphObject] = useState<import('./types').GraphProjectedObject>();
  const [routeGraphResolved, setRouteGraphResolved] = useState('');
  const routeLocationRef = useRef(location); useEffect(() => { routeLocationRef.current = location; }, [location]);
  const [routeReadError, setRouteReadError] = useState('');
  const lastLocations = useRef(new Map<string, WorkspaceLocation>());
  const [view, setRenderedView] = useState<View>('chat');
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
  const [dataOpen, setDataOpen] = useState(false);
  const [backups, setBackups] = useState<ManagedBackupList>();
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [backupsError, setBackupsError] = useState('');
  const backupRequestRef = useRef(0);
  const [syncError, setSyncError] = useState('');
  const [contextOpen, setContextOpen] = useState(false);
  const [contextHistory, setContextHistory] = useState<ContextHistoryState>();
  const historyRequestRef = useRef(0);
  const [contextPreview, setContextPreview] = useState<ContextPreview>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewRevision, setPreviewRevision] = useState(0);
  const [draftContext, setDraftContext] = useState({ query: '', attachmentIds: [] as string[] });
  const [decidingContext, setDecidingContext] = useState(false);
  const decisionInFlight = useRef(false);
  const decisionKeys = useRef(new Map<string, string>());
  const [trayPreview,setTrayPreview] = useState<ContextSelectionPreview>();
  const [trayBusy,setTrayBusy] = useState(false), [trayError,setTrayError] = useState(''), [trayNotice,setTrayNotice] = useState('');
  const trayRequest = useRef(0), trayRunning = useRef(false), trayKeys = useRef(new Map<string,string>());
  const traySources = useRef<ContextSourceRef[]>([]);
  const trayTargetRef = useRef(activeNodeId);
  const [focusedRun, setFocusedRun] = useState<ExecutionRun>();
  const [routeRunResolved, setRouteRunResolved] = useState('');
  const [resourceRead, setResourceRead] = useState<{ canonical: string; loading: boolean; data?: import('./types').ResourceVersionView; error?: string }>();
  const resourceRequestRef = useRef(0);
  const [resourceDownloadBusy, setResourceDownloadBusy] = useState(false);
  const [resourceDownloadError, setResourceDownloadError] = useState('');
  const [collaborations, setCollaborations] = useState<CollaborationRecord[]>([]);
  const [collaborationError, setCollaborationError] = useState('');
  const [collaborationBusy, setCollaborationBusy] = useState('');
  const [collaborationStreams, setCollaborationStreams] = useState<Record<string, { participantId: string; round: number; text: string }>>({});
  const collaborationController = useRef<AbortController | undefined>(undefined);
  const collaborationKeys = useRef(new Map<string, string>());
  const collaborationScope = useRef(0);

  const updateDraftContext = useCallback((query: string, attachmentIds: string[]) => setDraftContext({ query, attachmentIds }), []);
  const [manifests, setManifests] = useState<ContextManifest[]>([]);
  const [anchors,setAnchors]=useState<Anchor[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [boot, setBoot] = useState<'loading' | 'ready' | 'error'>('loading');
  const [bootError, setBootError] = useState('');
  const [online, setOnline] = useState(() => navigator.onLine);
  const [networkNotice, setNetworkNotice] = useState('');
  const [workspaceForm,setWorkspaceForm]=useState<'create'|'rename'>();
  const [mergeSource,setMergeSource]=useState<string>();
  const [workspaceModelId,setWorkspaceModelId]=useState<string>();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(() => localStorage.getItem('rhiza:onboarding-seen') !== '1');
  const [focusComposerRequest, setFocusComposerRequest] = useState(0);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | undefined>(location.workspaceId);
  const [activity, setActivity] = useState<WorkspaceActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState('');
  const [graphProjection, setGraphProjection] = useState<GraphProjectionResult>();
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState('');
  const [personalView, setPersonalView] = useState<PersonalGraphView>();
  const personalViewRef = useRef<PersonalGraphView | undefined>(undefined);
  const [personalLoading, setPersonalLoading] = useState(false);
  const personalRequestRef = useRef(0);
  // Same-Workspace background reads must not invalidate personal-view completion.
  const personalScopeRef = useRef(0);
  const personalSaving = useRef(false);
  const personalSaveKeys = useRef(new Map<string, string>());
  const [graphBatch, setGraphBatch] = useState<GraphBatchResult>();
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState('');
  const batchRunning = useRef(false);
  const batchInputRef = useRef<{ workspaceId?: string; items: GraphBatchItem[]; key: string } | undefined>(undefined);
  const batchUndoKeys = useRef(new Map<string, string>());
  const batchUndoRef = useRef<{ workspaceId?: string; batchId: string; key: string } | undefined>(undefined);

  const graphFiltersRef=useRef<{query?:string;statuses?:string[];updatedAfter?:string;objectTypes?:('conversation'|'segment'|'message')[]}>({});
  const graphRequestRef = useRef(0);
  const graphPagesRef = useRef(1);
  const graphCompleteRef = useRef(false);
  const workspaceGenerationRef = useRef(0);
  const [initialWorkspaceId] = useState(location.workspaceId);
  const selectedWorkspaceRef = useRef<string | undefined>(undefined);
  const modalReturnFocusRef = useRef<HTMLElement | null>(null);
  const activeModalRef = useRef<HTMLElement | null>(null);

  const manifestOwnerId = contextHistory?.data?.manifest.nodeId;
  const manifestDiscussionId = collaborations.find(record => record.nodeId === manifestOwnerId)?.base.nodeId ?? manifestOwnerId;
  const viewedNodeId = location.nodeId ?? (location.kind === 'manifest' ? manifestDiscussionId : undefined) ?? activeNodeId;
  const activeNode = discussionNodes.find(node => node.id === viewedNodeId && !collaborations.some(record => record.nodeId === node.id)) ?? initialNode;
  const locationReadOnly = activeNode.status === 'archived' || workspaces.find(item => item.workspaceId === currentWorkspaceId)?.status === 'archived' || (location.kind === 'segment' && segments.some(segment => segment.id === location.objectId && segment.nodeId === viewedNodeId && segment.status === 'archived'));
  const closeContext = useCallback(() => { if (contextOpen) navigationClose({kind:'conversation',workspaceId:currentWorkspaceId,nodeId:viewedNodeId}); },[contextOpen,navigationClose,currentWorkspaceId,viewedNodeId]);
  const setView = useCallback((target: View) => navigationNavigate(viewLocation(currentWorkspaceId ?? '', target, viewedNodeId)), [navigationNavigate, currentWorkspaceId, viewedNodeId]);
  const applyWorkspace = useCallback((workspace: WorkspaceSnapshot) => {
    setLoadedWorkspaceId(workspace.projectId);
    setContextItems(workspace.contextItems);
    setMessages(workspace.messages);
    setAttachments(workspace.attachments || []);
    setMode(workspace.mode);setWorkspaceModelId(workspace.defaultModelId);
    setDiscussionNodes(workspace.discussionNodes);
    setDiscussionEdges(workspace.discussionEdges);
    graphRequestRef.current += 1;
    setActiveNodeId(workspace.activeNodeId);
    setManifests(workspace.manifests || []);
    setSegments(workspace.segments || []);setAnchors(workspace.anchors || []);
  }, [setMessages, setManifests]);

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
  }, [applyWorkspace, setSyncError]);

  useEffect(() => { selectedWorkspaceRef.current = initialWorkspaceId; api.setWorkspace(initialWorkspaceId); void loadWorkspace(); }, [loadWorkspace, initialWorkspaceId]);
  useEffect(() => {
    if (boot !== 'ready' || !currentWorkspaceId || !activeNodeId) return;
    let current = true;
    const generation = workspaceGenerationRef.current;
    const workspaceId = selectedWorkspaceRef.current;
    setPreviewLoading(true); setPreviewError(''); setContextPreview(undefined);
    const timer = setTimeout(() => {
      void api.getContextPreview(draftContext.query, draftContext.attachmentIds).then(preview => {
        if (current && generation === workspaceGenerationRef.current && workspaceId === selectedWorkspaceRef.current) setContextPreview(preview);
      }).catch(error => {
        if (current && generation === workspaceGenerationRef.current && workspaceId === selectedWorkspaceRef.current) setPreviewError(presentErrorText(error, { message: '无法预览本轮上下文。', recovery: '请重新预览。' }));
      }).finally(() => { if (current && generation === workspaceGenerationRef.current && workspaceId === selectedWorkspaceRef.current) setPreviewLoading(false); });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [boot, currentWorkspaceId, activeNodeId, mode, contextItems, messages, draftContext, previewRevision]);
  useEffect(() => { setDraftContext({ query: '', attachmentIds: [] }); }, [currentWorkspaceId, activeNodeId]);
  const decideContext = async (decision: ContextRecommendationDecision) => {
    if (decisionInFlight.current) return;
    const current = workspaceMutation();
    const identity = JSON.stringify([selectedWorkspaceRef.current, decision]);
    const key = decisionKeys.current.get(identity) ?? crypto.randomUUID();
    decisionKeys.current.set(identity, key);
    decisionInFlight.current = true; setDecidingContext(true); setPreviewError('');
    try {
      const { workspace } = await api.decideContextRecommendation(decision, key);
      decisionKeys.current.delete(identity);
      if (current()) { applyWorkspace(workspace); setPreviewRevision(value => value + 1); }
    } catch (error) {
      if (current()) setPreviewError(presentErrorText(error, { message: '推荐确认未完成。', recovery: '来源可能已更新，请重新预览后确认。' }));
    } finally { decisionInFlight.current = false; if (current()) setDecidingContext(false); }
  };

  useEffect(() => {
    if (boot !== 'ready' || !currentWorkspaceId) return;
    let current = true; const generation = workspaceGenerationRef.current;
    setCollaborations([]);
    void api.listCollaborations().then(result => { if (current && generation === workspaceGenerationRef.current) setCollaborations(result.collaborations); }).catch(error => { if (current && generation === workspaceGenerationRef.current) setCollaborationError(presentErrorText(error, { message: '无法加载协作记录。', recovery: '请重新读取。' })); });
    return () => { current = false; };
  }, [boot, currentWorkspaceId]);
  useEffect(() => {
    collaborationScope.current += 1; setCollaborationBusy(''); setCollaborationError(''); setCollaborationStreams({});
    return () => { collaborationScope.current += 1; };
  }, [currentWorkspaceId, activeNodeId]);
  const rememberCollaboration = (record: CollaborationRecord) => setCollaborations(previous => [...previous.filter(item => item.id !== record.id), record]);
  const collaborationAction = async (identity: string, operation: (signal: AbortSignal, key: string, current: () => boolean) => Promise<void>) => {
    if (collaborationController.current) return false;
    const workspaceId = selectedWorkspaceRef.current; const generation = collaborationScope.current;
    const current = () => workspaceId === selectedWorkspaceRef.current && generation === collaborationScope.current;
    const controller = new AbortController(); collaborationController.current = controller;
    const keyIdentity = `${selectedWorkspaceRef.current}:${activeNodeId}:${identity}`;
    const key = collaborationKeys.current.get(keyIdentity) ?? crypto.randomUUID(); collaborationKeys.current.set(keyIdentity, key);
    setCollaborationBusy(identity); setCollaborationError('');
    try { await operation(controller.signal, key, current); collaborationKeys.current.delete(keyIdentity); return true; }
    catch (error) { if (current()) setCollaborationError(presentErrorText(error, { message: '协作操作未完成。', recovery: '请先重新读取记录，再决定是否重试单个模型。' })); return false; }
    finally { if (collaborationController.current === controller) { collaborationController.current = undefined; if (current()) setCollaborationBusy(''); } }
  };
  const startCollaboration = (input: CollaborationInput) => collaborationAction(`create:${JSON.stringify(input)}`, async (signal, key, current) => {
    const { collaboration } = await api.createCollaboration(input, key);
    if (!current()) return;
    rememberCollaboration(collaboration);
    if (collaboration.base.nodeId !== activeNodeId) throw new Error('协作所属讨论已变化，请重新读取记录。');
    setCollaborationBusy(`run:${collaboration.id}`);
    const result = await api.streamCollaboration(collaboration.id, event => {
      if (!current()) return;
      if (event.type === 'COLLABORATION_STATE') setCollaborations(records => records.map(record => record.id === event.collaborationId ? { ...record, revision: event.revision, status: event.status, budget: event.budget, attempts: event.attempts } : record));
      if (event.type === 'CONTENT_DELTA' || event.type === 'RUN_END') setCollaborationStreams(streams => ({ ...streams, [event.requestId]: { participantId: event.participantId, round: event.round, text: event.type === 'RUN_END' ? event.text : (streams[event.requestId]?.text ?? '') + event.delta } }));
    }, `${key}:run`, signal);
    if (current()) { rememberCollaboration(result.collaboration); setCollaborationStreams({}); }
  });
  const changeCollaboration = (record: CollaborationRecord, operation: 'retry' | 'synthesize' | 'retain' | 'refresh', attemptId?: string) => collaborationAction(`${operation}:${record.id}:${attemptId ?? record.revision}`, async (signal, key, current) => {
    if (record.base.nodeId !== activeNodeId || record.workspaceId !== selectedWorkspaceRef.current) return;
    if (operation === 'retain') {
      await api.retainCollaboration(record.id, record.base.nodeId, key);
      if (current()) await loadWorkspace(true);
      return;
    }
    const result = operation === 'retry' ? await api.retryCollaborationParticipant(record.id, attemptId!, key, signal) : operation === 'synthesize' ? await api.synthesizeCollaboration(record.id, key, signal) : await api.getCollaboration(record.id);
    if (current()) rememberCollaboration(result.collaboration);
  });
  const stopCollaboration = async (record: CollaborationRecord) => {
    if (record.base.nodeId !== activeNodeId || record.workspaceId !== selectedWorkspaceRef.current) return;
    const guard = workspaceMutation(); const generation = collaborationScope.current;
    collaborationController.current?.abort();
    const identity = `${record.workspaceId}:stop:${record.id}`;
    const key = collaborationKeys.current.get(identity) ?? crypto.randomUUID(); collaborationKeys.current.set(identity, key);
    try { const result = await api.stopCollaboration(record.id, key); if (guard() && generation === collaborationScope.current) { rememberCollaboration(result.collaboration); setCollaborationError(''); } }
    catch (error) { if (guard() && generation === collaborationScope.current) setCollaborationError(presentErrorText(error, { message: '停止状态待确认。', recovery: '请重新读取协作记录。' })); }
  };
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
  const loadGraph = useCallback(async (cursor?: string) => {
    const workspaceId = selectedWorkspaceRef.current; const generation = workspaceGenerationRef.current;
    const requestId = ++graphRequestRef.current;
    if(!cursor)graphDetailKeys.current.clear();
    const current = () => requestId === graphRequestRef.current && generation === workspaceGenerationRef.current && workspaceId === selectedWorkspaceRef.current;
    setGraphLoading(true); setGraphError('');
    try {
      let { graph } = await api.getGraphNeighborhood({ nodeLimit: 100, cursor,...graphFiltersRef.current });
      let pages = 1;
      // Refresh the user's loaded range after edits, including a new final page when needed.
      const targetPages = cursor ? 1 : Math.min(10,graphPagesRef.current + Number(graphCompleteRef.current));
      while (graph.nextCursor && pages < targetPages && current()) {
        const next = (await api.getGraphNeighborhood({ nodeLimit: 100, cursor: graph.nextCursor,...graphFiltersRef.current })).graph;
        if(next.version!==graph.version||next.checkpoint!==graph.checkpoint) throw new Error('图谱已更新，请刷新图谱后继续。');
        graph = boundedGraphCache({ ...next, objects: [...graph.objects, ...next.objects], relations: [...graph.relations, ...next.relations] });
        pages += 1;
      }
      if (!current()) return;
      graphPagesRef.current = cursor ? graphPagesRef.current + 1 : pages;
      graphCompleteRef.current = !graph.nextCursor;
      setGraphProjection(previous => boundedGraphCache(cursor && previous && previous.version === graph.version && previous.checkpoint === graph.checkpoint ? {
        ...graph,
        objects: [...new Map([...previous.objects, ...graph.objects].map(item => [item.ref.objectId, item])).values()],
        relations: [...new Map([...previous.relations, ...graph.relations].map(item => [item.id, item])).values()],
      } : graph));
    } catch (error) {
      if (current()) setGraphError(presentErrorText(error, { message: '无法加载图谱。', recovery: '请刷新图谱后重试。' }));
    } finally { if (current()) setGraphLoading(false); }
  }, []);
  const filterGraph=useCallback((filters:{query?:string;statuses?:string[];updatedAfter?:string;objectTypes?:('conversation'|'segment'|'message')[]})=>{if(JSON.stringify(filters)===JSON.stringify(graphFiltersRef.current))return;graphFiltersRef.current=filters;graphPagesRef.current=1;graphCompleteRef.current=false;void loadGraph();},[loadGraph]);
  const graphDetailKeys=useRef(new Set<string>());
  const loadGraphNeighborhood=useCallback((objectId:string)=>{
    if(!graphProjection?.version)return;
    const workspaceId=selectedWorkspaceRef.current;const generation=workspaceGenerationRef.current;const request=graphRequestRef.current;const filters=JSON.stringify(graphFiltersRef.current);const cacheKey=`${workspaceId}:${graphProjection?.version}:${graphProjection?.checkpoint}:${objectId}:conversation,segment,message:${filters}`;
    if(graphDetailKeys.current.has(cacheKey))return;graphDetailKeys.current.add(cacheKey);if(graphDetailKeys.current.size>100)graphDetailKeys.current.delete(graphDetailKeys.current.values().next().value!);
    void api.getGraphNeighborhood({objectId,depth:2,nodeLimit:200,edgeLimit:800,objectTypes:['conversation','segment','message'],...graphFiltersRef.current}).then(({graph})=>{if(workspaceId===selectedWorkspaceRef.current&&generation===workspaceGenerationRef.current&&request===graphRequestRef.current&&filters===JSON.stringify(graphFiltersRef.current))setGraphProjection(previous=>previous&&previous.checkpoint===graph.checkpoint&&previous.version===graph.version?boundedGraphCache({...previous,objects:[...previous.objects,...graph.objects],relations:[...previous.relations,...graph.relations]}):previous);}).catch(()=>{graphDetailKeys.current.delete(cacheKey);});
  },[graphProjection]);
  const highlightGraphPath=async(from:string,to:string)=>{
    const current=workspaceMutation();const request=graphRequestRef.current;const filters=JSON.stringify(graphFiltersRef.current);
    const version=graphProjection?.version;const checkpoint=graphProjection?.checkpoint;
    const {graph}=await api.getGraphPath(from,to);
    if(!current()||request!==graphRequestRef.current||filters!==JSON.stringify(graphFiltersRef.current)||graph.version!==version||graph.checkpoint!==checkpoint)return [];
    setGraphProjection(previous=>previous&&previous.version===version&&previous.checkpoint===checkpoint?boundedGraphCache({...previous,objects:[...previous.objects,...graph.objects],relations:[...previous.relations,...graph.relations]}):previous);
    return graph.objects.map(item=>item.ref.objectId);
  };
  useEffect(() => { if (view === 'graph' && boot === 'ready') void loadGraph(); }, [view, boot, currentWorkspaceId, discussionNodes, loadGraph]);
  useEffect(() => { if (api.listWorkspaces) void api.listWorkspaces(true).then(result => setWorkspaces(result.workspaces)).catch(() => undefined); }, []);
  const loadPersonalView = useCallback(async () => {
    const scope = selectedWorkspaceRef.current; const generation = personalScopeRef.current; const request = ++personalRequestRef.current;
    const current = () => scope === selectedWorkspaceRef.current && generation === personalScopeRef.current && request === personalRequestRef.current;
    setPersonalLoading(true);
    try { const result = await api.getPersonalGraphView(); if (current() && (!personalViewRef.current || result.revision >= personalViewRef.current.revision)) { personalViewRef.current = result; setPersonalView(result); } }
    catch (error) { if (current()) setGraphError(presentErrorText(error, { message: '无法读取个人视图。', recovery: '请重新读取后再保存。' })); }
    finally { if (current()) setPersonalLoading(false); }
  }, []);
  useEffect(() => { personalScopeRef.current++; personalRequestRef.current++; personalViewRef.current = undefined; setPersonalView(undefined); setGraphBatch(undefined); setBatchError(''); batchInputRef.current = undefined; batchUndoRef.current = undefined; setBatchBusy(false); }, [currentWorkspaceId]);
  useEffect(() => { if (view === 'graph' && boot === 'ready') void loadPersonalView(); }, [view, boot, currentWorkspaceId, loadPersonalView]);
  const savePersonalInput = async (input: GraphViewInput) => {
    const original = personalViewRef.current; const scope = selectedWorkspaceRef.current; const generation = personalScopeRef.current;
    if (!original || personalSaving.current) throw new Error('个人视图尚未就绪或保存仍在进行。');
    const identity = JSON.stringify([scope, original.revision, input]); const key = personalSaveKeys.current.get(identity) ?? crypto.randomUUID(); personalSaveKeys.current.set(identity, key);
    personalSaving.current = true;
    try { const receipt = await api.savePersonalGraphView(input, original.revision, key); if (scope !== selectedWorkspaceRef.current || generation !== personalScopeRef.current) return; personalSaveKeys.current.delete(identity); if (personalViewRef.current && receipt.revision < personalViewRef.current.revision) return; const next = { ...original, ...input, ...receipt, source: 'personal' as const }; personalViewRef.current = next; setPersonalView(next); }
    finally { personalSaving.current = false; }
  };
  const saveGraphPresentation = async (presentation: GraphPersonalPresentation) => {
    const original = personalViewRef.current; if (!original) throw new Error('请先读取个人视图。');
    const changes = new Map(Object.entries(presentation.positions).map(([objectId, position]) => [objectId, { objectId, ...position, objectType: graphProjection?.objects.find(item => item.ref.objectId === objectId)?.ref.objectType ?? 'conversation', collapsed: presentation.collapsedIds.includes(objectId) }]));
    const positions = [...original.positions.filter(item => !changes.has(item.objectId)), ...changes.values()] as PersonalGraphView['positions'];
    await savePersonalInput({ positions, viewport: presentation.viewport ? { x: presentation.viewport.x, y: presentation.viewport.y, zoom: presentation.viewport.scale } : original.viewport, filters: { ...original.filters, ...(presentation.layers ? {objectTypes:presentation.layers} : {objectTypes:[]}), relationTypes: presentation.relationTypes ? presentation.relationTypes.map(type=>type.replaceAll('-','_')) : presentation.relationFilter ? [presentation.relationFilter.replaceAll('-', '_')] : [] } });
  };
  const runGraphBatch = async (operation: 'apply' | 'resume' | 'read' | 'undo', input?: { ids: string[]; operation: 'archive' | 'relate'; relation?: GraphRelation }) => {
    if (batchRunning.current) return;
    const scope = selectedWorkspaceRef.current;
    if (operation === 'apply' && input) {
      const items: GraphBatchItem[] = input.operation === 'archive' ? input.ids.map(id => ({ itemId: id, commandType: 'ArchiveObject', payload: { nodeId: id } })) : input.ids.slice(1).map(id => ({ itemId: id, commandType: 'CreateRelation', payload: { source: input.ids[0], target: id, relation: input.relation ?? 'related-to', label: '' } }));
      const previous = batchInputRef.current;
      if (!previous || previous.workspaceId !== scope || graphBatch?.status === 'completed' || batchUndoRef.current || JSON.stringify(previous.items) !== JSON.stringify(items)) batchInputRef.current = { workspaceId: scope, items, key: crypto.randomUUID() };
      batchUndoRef.current = undefined;
    }
    const frozen = batchInputRef.current;
    if ((operation === 'apply' || operation === 'resume') && (!frozen || frozen.workspaceId !== scope)) return;
    if ((operation === 'read' || operation === 'undo') && !graphBatch) return;
    batchRunning.current = true; setBatchBusy(true); setBatchError('');
    try {
      let result: GraphBatchResult;
      if (operation === 'read') result = await api.getGraphBatch(graphBatch!.batchId);
      else if (operation === 'undo') { const identity = `${scope}:${graphBatch!.batchId}`; const key = batchUndoKeys.current.get(identity) ?? crypto.randomUUID(); batchUndoKeys.current.set(identity, key); batchUndoRef.current = { workspaceId: scope, batchId: graphBatch!.batchId, key }; result = await api.undoGraphBatch(graphBatch!.batchId, key); }
      else if (operation === 'resume' && batchUndoRef.current && batchUndoRef.current.workspaceId === scope) result = await api.undoGraphBatch(batchUndoRef.current.batchId, batchUndoRef.current.key);
      else result = await api.batchGraphOperations(frozen!.items, frozen!.key);
      if (scope !== selectedWorkspaceRef.current) return;
      setGraphBatch(result);
      if (operation !== 'read') await loadWorkspace(true);
    } catch (error) { if (scope === selectedWorkspaceRef.current) setBatchError(presentErrorText(error, { message: '批量状态待确认。', recovery: '请读取结果或继续原批次；已完成项不会重复执行。' })); }
    finally { batchRunning.current = false; if (scope === selectedWorkspaceRef.current) setBatchBusy(false); }
  };
  const refreshBackups = useCallback(async () => {
    const scope = selectedWorkspaceRef.current; const request = ++backupRequestRef.current;
    setBackupsLoading(true); setBackupsError('');
    try { const result = await api.listManagedBackups(); if (scope === selectedWorkspaceRef.current && request === backupRequestRef.current) setBackups(result); }
    catch (error) { if (scope === selectedWorkspaceRef.current && request === backupRequestRef.current) setBackupsError(presentErrorText(error, { message: '无法读取备份。', recovery: '请刷新后重试。' })); }
    finally { if (scope === selectedWorkspaceRef.current && request === backupRequestRef.current) setBackupsLoading(false); }
  }, []);
  useEffect(() => { setBackups(undefined); backupRequestRef.current++; if (dataOpen) void refreshBackups(); }, [dataOpen, currentWorkspaceId, refreshBackups]);
  const openCurrentContext = () => navigationNavigate({ kind: 'context', workspaceId: selectedWorkspaceRef.current });
  const inspectMessageContext = (messageId: string, manifestId?: string) => {
    const message = messages.find(item => item.id === messageId);
    navigationNavigate(manifestId ? { kind: 'manifest', workspaceId: selectedWorkspaceRef.current, objectId: manifestId } : { kind: 'message', workspaceId: selectedWorkspaceRef.current, nodeId: message?.nodeId ?? location.nodeId ?? activeNodeId, objectId: messageId, detail: 'context' });
  };
  const readMessageContext = async (messageId: string, manifestId?: string) => {
    const request = ++historyRequestRef.current;
    const generation = workspaceGenerationRef.current;
    setContextOpen(true); setContextHistory({ messageId, manifestId, loading: true });
    try {
      const data = await (manifestId ? api.getManifestContext(manifestId) : api.getMessageContext(messageId));
      if (data.manifest.projectId !== selectedWorkspaceRef.current || (manifestId && data.manifest.id !== manifestId) || (messageId && data.manifest.nodeId !== messages.find(message => message.id === messageId)?.nodeId)) throw new Error('历史上下文身份不匹配。');
      const ownership = await api.getNodeCollaboration(data.manifest.nodeId);
      if (ownership.collaborations.some(record => record.workspaceId !== data.manifest.projectId || record.nodeId !== data.manifest.nodeId)) throw new Error('协作归属身份不匹配。');
      if (request === historyRequestRef.current && generation === workspaceGenerationRef.current) {
        ownership.collaborations.forEach(rememberCollaboration);
        setContextHistory({ messageId, manifestId, loading: false, data });
      }
    } catch (error) {
      if (request === historyRequestRef.current && generation === workspaceGenerationRef.current) setContextHistory({ messageId, manifestId, loading: false, error: presentErrorText(error, { message: '无法读取这轮上下文。', recovery: '请重新加载。' }) });
    }
  };
  const switchWorkspace = async (workspaceId: string) => {
    setDataOpen(false); setContextOpen(false); setLoadedWorkspaceId(undefined); setRouteReadError('');
    historyRequestRef.current++; setContextHistory(undefined);
    resourceRequestRef.current++; setResourceRead(undefined); setResourceDownloadBusy(false); setResourceDownloadError('');
    setContextPreview(undefined); setPreviewError(''); setDecidingContext(false); setFocusedRun(undefined); setRouteRunResolved('');
    const generation = ++workspaceGenerationRef.current;
    if (selectedWorkspaceRef.current !== workspaceId) personalScopeRef.current++;
    selectedWorkspaceRef.current = workspaceId;
    graphRequestRef.current += 1; graphPagesRef.current = 1; graphCompleteRef.current = false; setGraphProjection(undefined); setGraphError('');
    setMessages([]); setDiscussionNodes([]); setContextItems([]); setAttachments([]); setDiscussionEdges([]); setSegments([]); setManifests([]); setActivity([]); setActiveNodeId('');
    graphFiltersRef.current={}; graphDetailKeys.current.clear();setAnchors([]);
    api.setWorkspace(workspaceId); setCurrentWorkspaceId(workspaceId);
    try {
      const { workspace } = await api.getScopedWorkspace(workspaceId);
      if (generation !== workspaceGenerationRef.current || workspaceId !== selectedWorkspaceRef.current) return;
      applyWorkspace(workspace); setBoot('ready'); setSyncError('');
    } catch (error) {
      if (generation !== workspaceGenerationRef.current || workspaceId !== selectedWorkspaceRef.current) return;
      setSyncError(presentErrorText(error, { message: '无法加载所选工作区。', recovery: '请检查网络后重试。' }));
    }
  };
  const refreshWorkspaces = async () => { const items = (await api.listWorkspaces(true)).workspaces; setWorkspaces(items); return items; };
  const createWorkspace = async (name:string) => { const current=workspaceMutation();const {workspace}=await api.createWorkspace(name);if(!current())return;await refreshWorkspaces();if(current())navigationNavigate({kind:'workspace',workspaceId:workspace.workspaceId}); };
  const workspaceRecord = () => workspaces.find(item => item.workspaceId === currentWorkspaceId);
  const renameWorkspace = async (name:string) => { const current=workspaceMutation();const record=workspaceRecord();if(!record)return;await api.updateWorkspace(record.workspaceId,'rename',record.revision,name);if(current())await refreshWorkspaces(); };
  const archiveWorkspace = async () => { const current = workspaceMutation(); const record = workspaceRecord(); if (!record) return; await api.updateWorkspace(record.workspaceId, 'archive', record.revision); if (!current()) return; const items = await refreshWorkspaces(); if (!current()) return; const next = items.find(item => item.workspaceId !== record.workspaceId && item.status === 'active'); if (next) navigationNavigate({kind:'workspace',workspaceId:next.workspaceId}); };
  const restoreWorkspace = async () => { const current = workspaceMutation(); const record = workspaceRecord(); if (!record) return; await api.updateWorkspace(record.workspaceId, 'restore', record.revision); if (current()) await refreshWorkspaces(); };
  useEffect(() => {
    const goOffline = () => { setOnline(false); setNetworkNotice('当前离线，发送已暂停。'); };
    const goOnline = () => {
      setOnline(true);
      setNetworkNotice('网络已恢复，正在刷新工作区。');
      void loadWorkspace(Boolean(selectedWorkspaceRef.current)).then(result => {
        if (result !== 'stale') setNetworkNotice(result === 'loaded' ? '网络已恢复，工作区已刷新。' : '网络已恢复，但工作区刷新失败。');
      });
    };
    window.addEventListener('offline', goOffline); window.addEventListener('online', goOnline);
    return () => { window.removeEventListener('offline', goOffline); window.removeEventListener('online', goOnline); };
  }, [loadWorkspace]);
  const handleKeydown = useEffectEvent((event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (onboardingOpen) {
        if (event.key === 'Escape') { localStorage.setItem('rhiza:onboarding-seen', '1'); setOnboardingOpen(false); }
        return;
      }
      if (paletteOpen) {
        if (event.key === 'Escape') setPaletteOpen(false);
        return;
      }
      if (dataOpen) {
        if (event.key === 'Escape') navigationClose({ kind: 'workspace', workspaceId: selectedWorkspaceRef.current });
        return;
      }
      if (settingsOpen) {
        if (event.key === 'Escape') navigationClose({ kind: 'workspace', workspaceId: selectedWorkspaceRef.current });
        return;
      }
      if (event.key === 'Escape') { setPaletteOpen(false); if (contextOpen) { event.preventDefault(); closeContext(); } return; }
      if (modifier && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen(true); return; }
      if (modifier && event.key === '1') { event.preventDefault(); setView('chat'); }
      if (modifier && event.key === '2') { event.preventDefault(); setView('graph'); }
      if (modifier && event.key === '3') { event.preventDefault(); setView('state'); }
      if (modifier && event.key === '4') { event.preventDefault(); setView('activity'); }
      if (modifier && event.shiftKey && event.key.toLowerCase() === 'c') { event.preventDefault(); openCurrentContext(); }
      if (event.key === '/' && !modifier && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); setView('chat'); setFocusComposerRequest(value => value + 1); }
  });
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => handleKeydown(event);
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, []);
  useEffect(() => {
    if (!paletteOpen && !onboardingOpen && !settingsOpen && !dataOpen) return;
    modalReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dataOpen ? document.querySelector<HTMLElement>('.workspace-data-dialog') : settingsOpen ? document.querySelector<HTMLElement>('.provider-settings') : activeModalRef.current;
    const background = [...document.querySelectorAll<HTMLElement>('.workbench-main, .mobile-navigation, .sidebar')];
    const previousInert = background.map(element => element.inert);
    background.forEach(element => { element.inert = true; });
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])];
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
    return () => { document.removeEventListener('keydown', trapFocus); background.forEach((element, index) => { element.inert = previousInert[index]; }); modalReturnFocusRef.current?.focus(); };
  }, [onboardingOpen, paletteOpen, settingsOpen, dataOpen]);

  const applyCatalog = (catalog: ProviderCatalog) => {
    setProviderCatalog(catalog);
    const activeModel = catalog.models.find(model => model.id === catalog.activeModelId);
    const activeProvider = catalog.providers.find(item => item.id === activeModel?.providerId);
    setProvider({ configured: Boolean(activeModel && activeProvider?.configured), name: activeProvider?.name || '未配置供应商', model: activeModel?.displayName || '未选择模型', baseUrl: activeProvider?.baseUrl || '' });
  };

  const openSettings = () => navigationNavigate({ kind: 'settings' });
  const readSettings = async () => {
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
  const discoverProviderBatch = async (ids: string[], failedOnly: boolean) => { const result = await api.discoverProviderBatch(ids, failedOnly); applyCatalog(result.catalog); return result.results; };
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

  const previewTray = async (nodes?: GraphNodeModel[]) => {
    if (workspaceRecord()?.status === 'archived' || trayRunning.current) return;
    if (nodes) {
      if (!nodes.length || nodes.length > 100 || nodes.some(node=>node.lifecycle==='tombstoned'||node.status==='archived'||node.objectType==='message')) return;
      traySources.current = nodes.map(node=>({sourceType:node.objectType==='segment'?'segment':'node',sourceId:node.id}));
    }
    if (!traySources.current.length) return;
    const sources = [...traySources.current], expectedNodeId = activeNodeId, scope = selectedWorkspaceRef.current, request = ++trayRequest.current;
    const current = () => request===trayRequest.current && scope===selectedWorkspaceRef.current && expectedNodeId===trayTargetRef.current;
    setTrayBusy(true); setTrayPreview(undefined); setTrayError(''); setTrayNotice('');
    try {
      const result = await api.previewContextSelection(sources);
      if (!current()) return;
      if (result.workspaceId !== scope || result.expectedNodeId !== expectedNodeId || result.sources.length !== sources.length || result.sources.some((item,index)=>item.sourceId!==sources[index].sourceId||item.sourceType!==sources[index].sourceType)) throw new Error('来源或目标讨论已变化。');
      setTrayPreview(result);
    } catch (error) { if (current() && request === trayRequest.current) setTrayError(presentErrorText(error,{message:'无法审阅所选来源。',recovery:'请重新选择并审阅。'})); }
    finally { if (current() && request === trayRequest.current) setTrayBusy(false); }
  };
  const confirmTray = async () => {
    if (!trayPreview || trayBusy || trayRunning.current || trayPreview.overBudget || trayPreview.status !== 'ready' || workspaceRecord()?.status === 'archived' || trayPreview.expectedNodeId !== activeNodeId || trayPreview.workspaceId !== selectedWorkspaceRef.current) return;
    const frozen = trayPreview, current = workspaceMutation(), request = trayRequest.current;
    const identity = JSON.stringify([frozen.workspaceId,frozen.expectedNodeId,frozen.sources.map(({sourceType,sourceId,sourceRevision})=>({sourceType,sourceId,sourceRevision}))]);
    const key = trayKeys.current.get(identity) ?? crypto.randomUUID(); trayKeys.current.set(identity,key);
    trayRunning.current = true; setTrayBusy(true); setTrayError('');
    try {
      const {workspace} = await api.confirmContextSelection(frozen,key);
      if (request !== trayRequest.current || frozen.workspaceId !== selectedWorkspaceRef.current || frozen.expectedNodeId !== trayTargetRef.current) return;
      if (workspace.projectId !== frozen.workspaceId || workspace.activeNodeId !== frozen.expectedNodeId) throw new Error('确认结果身份不匹配。');
      if(current()) applyWorkspace(workspace); else void loadWorkspace(true);
      setTrayPreview(undefined); setTrayNotice(`已将 ${frozen.sources.length} 个来源加入当前讨论。下一次回答使用确认后的选择。`); trayKeys.current.delete(identity);
    } catch (error) {
      if (current() && request === trayRequest.current) {
        const status = error && typeof error==='object' && 'status' in error ? error.status : undefined;
        if ([403,404,409,410].includes(status as number)) { setTrayPreview(undefined); trayKeys.current.delete(identity); }
        setTrayError(presentErrorText(error,{message:'来源尚未确认加入。',recovery:'请重新审阅；网络结果不确定时可用原确认重试。'}));
      }
    } finally { if(request===trayRequest.current) { trayRunning.current=false; setTrayBusy(false); } }
  };
  useEffect(() => { trayTargetRef.current=activeNodeId; trayRequest.current++; trayRunning.current=false; traySources.current=[]; setTrayPreview(undefined); setTrayBusy(false); setTrayError(''); setTrayNotice(''); },[currentWorkspaceId,activeNodeId]);
  const shareGraphFilters = async (graphFilters: GraphDisplayFilters) => {
    const target:WorkspaceLocation={kind:'graph',workspaceId:currentWorkspaceId,graphFilters}; const canonical=formatLocation(target);
    navigationNavigate(target);
    try { await navigator.clipboard.writeText(`${window.location.href.split('#')[0]}${canonical}`); return true; } catch { return false; }
  };

  const ensureExecutionNode = async () => {
    const id = viewedNodeId;
    const node = discussionNodes.find(item => item.id === id);
    if (!node || locationReadOnly || collaborations.some(record => record.nodeId === id) || (location.kind === 'manifest' && !contextHistory?.data)) throw new Error('此位置只读，无法继续对话。');
    const scope = selectedWorkspaceRef.current; const currentOwnership = workspaceMutation();
    const ownership = await api.getNodeCollaboration(id);
    if (!currentOwnership() || ownership.collaborations.some(record => record.workspaceId !== scope || record.nodeId !== id)) throw new Error('无法核实讨论归属，请重新读取。');
    if (ownership.collaborations.length) throw new Error('此节点是协作内部记录，请从发起讨论继续。');
    if (id !== activeNodeId) { const current = workspaceMutation(); const { workspace } = await api.activateNode(id); if (!current() || workspace.activeNodeId !== id) throw new Error('讨论切换尚未完成，请重试。'); applyWorkspace(workspace); }
    return id;
  };
  const sendMessage = async (text: string, options: ChatRequestOptions = {}) => {
    const executionNodeId = await ensureExecutionNode();
    const current = workspaceMutation();
    const pendingId = `pending-${Date.now()}`;
    const pendingAssistantId = `${pendingId}-assistant`;
    const pending: Message = { id: pendingId, nodeId: executionNodeId, kind: 'user', text, createdAt: new Date().toISOString(), pending: true, attachmentIds: options.attachmentIds, operation: options.operation };
    const pendingAssistant: Message = { id: pendingAssistantId, nodeId: executionNodeId, kind: 'assistant', text: '', createdAt: new Date().toISOString(), pending: true, operation: options.operation };
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
    await ensureExecutionNode();
    const current = workspaceMutation();
    const { workspace } = await api.createBranch(input);
    if (!current()) return;
    applyWorkspace(workspace);
    navigationNavigate({kind:'conversation',workspaceId:workspace.projectId,nodeId:workspace.activeNodeId});
    setSyncError('');
  };
  const sendTemporaryMessage = async (input: { sourceNodeId: string; anchorText: string; message: string; history: Array<Pick<Message, 'kind' | 'text'>> },onEvent?: Parameters<typeof api.streamTemporaryMessage>[1],options?: ChatRequestOptions) => api.streamTemporaryMessage(input,onEvent??(()=>undefined),options);
  const activateNode = async (id: string, _openChat = false) => { navigationNavigate({ kind: 'conversation', workspaceId: selectedWorkspaceRef.current, nodeId: id }); };
  const moveNode = async (id: string, x: number, y: number) => {
    const original = personalViewRef.current; if (!original) throw new Error('个人视图尚未就绪。');
    const prior = original.positions.find(item => item.objectId === id);
    await savePersonalInput({ viewport: original.viewport, filters: original.filters, positions: [...original.positions.filter(item => item.objectId !== id), { objectType: 'conversation', objectId: id, x, y, collapsed: prior?.collapsed ?? false }] });
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
    const { workspace } = segments.some(segment=>segment.id===id)?await api.updateSegment(id,{status:'active'}):await api.restoreGraphNode(id);
    if (!current()) return;
    applyWorkspace(workspace);
    setSyncError('');
  };
  const purgeGraphNode = async (id: string, confirmation: string, reason: string) => {
    const scope = selectedWorkspaceRef.current;
    const current = workspaceMutation();
    const { workspace } = await api.purgeGraphNode(id, confirmation, reason);
    if (scope !== selectedWorkspaceRef.current) return;
    resourceRequestRef.current++; setResourceRead(undefined); setResourceDownloadBusy(false); setResourceDownloadError('');
    if (routeLocationRef.current.kind === 'resources' && routeLocationRef.current.workspaceId) navigationForget(routeLocationRef.current.workspaceId, formatLocation(routeLocationRef.current));
    if (current()) applyWorkspace(workspace);
    if (routeLocationRef.current.kind === 'resources') void readResourceLocation(routeLocationRef.current);
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
  const mergeNode = async (id:string) => { setMergeSource(id); };
  const activeCount = contextPreview?.items.length ?? 0;
  const navigableNodes = discussionNodes.filter(node => node.status !== 'archived' && !collaborations.some(record => record.nodeId === node.id));
  const openWorkspace = (id: string) => navigationNavigate(lastLocations.current.get(id) ?? { kind: 'workspace', workspaceId: id });
  const closeData = () => navigationClose({ kind: 'workspace', workspaceId: selectedWorkspaceRef.current });
  const closeSettings = () => navigationClose({ kind: 'workspace', workspaceId: selectedWorkspaceRef.current });
  const activeMessages = messages.filter(message => message.nodeId === activeNode.id);
  const graphModel = useMemo(
    () => {
      const augmented = graphProjection && routeGraphObject && routeGraphObject.ref.workspaceId === currentWorkspaceId ? {...graphProjection,objects:[...graphProjection.objects.filter(item=>item.ref.objectId!==routeGraphObject.ref.objectId),routeGraphObject]} : graphProjection;
      const model = augmented ? projectionToGraphPresentationModel(augmented) : toGraphPresentationModel([], []);
      const internalIds = new Set(collaborations.map(record => record.nodeId));
      messages.filter(message => internalIds.has(message.nodeId)).forEach(message => internalIds.add(message.id));
      segments.filter(segment => internalIds.has(segment.nodeId)).forEach(segment => internalIds.add(segment.id));
      for (let depth = 0; depth < 3; depth++) augmented?.relations.filter(edge => edge.relationType === 'contains' && internalIds.has(edge.source.objectId)).forEach(edge => internalIds.add(edge.target.objectId));
      return { nodes: model.nodes.filter(node => !internalIds.has(node.id)), edges: model.edges.filter(edge => !internalIds.has(edge.source) && !internalIds.has(edge.target)) };
    },
    [graphProjection, collaborations, routeGraphObject, currentWorkspaceId, messages, segments],
  );

  const graphPersonal = useMemo(() => personalView ? toGraphPersonalPresentation(personalView) : undefined, [personalView]);

  const readRunLocation = async (target: WorkspaceLocation) => {
    if (target.kind !== 'runs' || !target.objectId) return;
    const current = workspaceMutation(); const canonical = formatLocation(target);
    try {
      const {run} = await api.getRun(target.objectId);
      if (!current() || routeLocationRef.current !== target) return;
      if (run.id !== target.objectId || run.workspaceId !== target.workspaceId) { setRouteReadError('无法访问此执行记录。'); return; }
      setFocusedRun(run); setRouteRunResolved(canonical);
    } catch { if (current() && routeLocationRef.current === target) setRouteReadError('无法访问此执行记录。'); }
  };
  const readResourceLocation = async (target: WorkspaceLocation) => {
    if (target.kind !== 'resources' || !target.objectId || !target.versionId) return;
    const canonical = formatLocation(target), request = ++resourceRequestRef.current;
    const current = () => request === resourceRequestRef.current && selectedWorkspaceRef.current === target.workspaceId && formatLocation(routeLocationRef.current) === canonical;
    setResourceRead({canonical,loading:true}); setResourceDownloadError('');
    try {
      const data = await api.getResourceVersion(target.objectId,target.versionId);
      if (!current()) return;
      if (data.resource.workspaceId !== target.workspaceId || data.resource.id !== target.objectId || data.version.resourceId !== target.objectId || data.version.id !== target.versionId) throw new Error('资源身份不匹配');
      setResourceRead({canonical,loading:false,data});
    } catch (error) { if (current()) setResourceRead({canonical,loading:false,error:presentErrorText(error,{message:'无法读取此资源版本。',recovery:'缺失、已清除或校验失败的版本不能替换为当前内容。'})}); }
  };
  const downloadResourceVersion = async () => {
    const target = location, canonical = formatLocation(target), request = resourceRequestRef.current;
    if (resourceDownloadBusy || !target.objectId || !target.versionId || resourceRead?.canonical !== canonical || !resourceRead.data) return;
    const current = () => request === resourceRequestRef.current && selectedWorkspaceRef.current === target.workspaceId && formatLocation(routeLocationRef.current) === canonical;
    setResourceDownloadBusy(true); setResourceDownloadError('');
    try {
      const blob = await api.getResourceVersionContent(target.objectId,target.versionId);
      if (!current()) return;
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      try { link.href=url; link.download='resource.bin'; link.click(); } finally { URL.revokeObjectURL(url); }
    } catch (error) {
      if (current()) {
        const message = presentErrorText(error,{message:'无法下载此版本原文。',recovery:'请重新读取资源后再试。'});
        const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
        if ([403,404,409,410].includes(status as number)) {
          resourceRequestRef.current++; setResourceRead({canonical,loading:false,error:message}); setResourceDownloadBusy(false);
          if (target.workspaceId) navigationForget(target.workspaceId,canonical);
        } else setResourceDownloadError(message);
      }
    }
    finally { if (current()) setResourceDownloadBusy(false); }
  };
  const resolveLocation = useEffectEvent(() => {
    if (boot === 'loading') return;
    if (location.workspaceId && location.workspaceId !== currentWorkspaceId) { void switchWorkspace(location.workspaceId); return; }
    if (location.kind === 'bootstrap' && currentWorkspaceId) { navigationNavigate(viewLocation(currentWorkspaceId, 'chat', activeNodeId), true); return; }
    if (location.workspaceId && loadedWorkspaceId !== location.workspaceId) return;
    setRouteReadError(''); setRouteGraphObject(undefined); setRouteGraphResolved(''); historyRequestRef.current++;
    setContextOpen(false); setDataOpen(false); setSettingsOpen(false); setContextHistory(undefined); setFocusedRun(undefined); setRouteRunResolved('');
    resourceRequestRef.current++; setResourceRead(undefined); setResourceDownloadBusy(false); setResourceDownloadError('');
    const targetView: View = ['graph','state','activity','runs'].includes(location.kind) ? location.kind as View : 'chat';
    setRenderedView(targetView);
    if (location.kind === 'settings') void readSettings();
    if (location.kind === 'data') setDataOpen(true);
    if (location.kind === 'context') setContextOpen(true);
    if (location.kind === 'manifest') void readMessageContext('', location.objectId);
    if (location.kind === 'message' && location.detail === 'context' && messages.some(message => message.id === location.objectId && message.nodeId === location.nodeId)) void readMessageContext(location.objectId!);
    if (location.kind === 'runs' && location.objectId) void readRunLocation(location);
    if (location.kind === 'resources' && location.objectId && location.versionId) void readResourceLocation(location);
    if (location.kind === 'graph' && location.objectId) {
      const target = location; const current = workspaceMutation(); const canonical = formatLocation(target);
      const accept = (object: import('./types').GraphProjectedObject | undefined) => {
        if (!current() || routeLocationRef.current !== target) return;
        if (!object || object.ref.workspaceId !== target.workspaceId || object.ref.objectType !== target.objectType || object.ref.objectId !== target.objectId || (target.versionId && object.ref.versionId !== target.versionId)) { setRouteReadError('无法访问此图谱对象或版本。'); return; }
        setRouteGraphObject(object); setRouteGraphResolved(canonical);
      };
      const known = graphProjection?.objects.find(object => object.ref.objectId === target.objectId && object.ref.objectType === target.objectType && (!target.versionId || object.ref.versionId === target.versionId));
      if (known) accept(known);
      else void api.getGraphNeighborhood({objectType:target.objectType,objectId:target.objectId,versionId:target.versionId,objectTypes:[...new Set(['conversation','segment','message',target.objectType!])],depth:2,nodeLimit:200,edgeLimit:800}).then(({graph})=>accept(graph.objects.find(object=>object.ref.objectId===target.objectId && object.ref.objectType===target.objectType))).catch(()=>{if(current() && routeLocationRef.current===target)setRouteReadError('无法访问此图谱对象或版本。');});
    }
  });
  useEffect(() => { resolveLocation(); }, [location, boot, currentWorkspaceId, loadedWorkspaceId]);
  let locationError = location.kind === 'invalid' ? '此链接格式不受支持。' : routeReadError;
  const scopedReady = !location.workspaceId || loadedWorkspaceId === location.workspaceId;
  if (scopedReady && location.nodeId && activeNode.id !== location.nodeId) locationError = '无法访问此位置。';
  if (scopedReady && location.kind === 'message' && !messages.some(message => message.id === location.objectId && message.nodeId === location.nodeId)) locationError = '无法访问此消息版本。';
  if (scopedReady && location.kind === 'segment' && !segments.some(segment => segment.id === location.objectId && segment.nodeId === location.nodeId)) locationError = '无法访问此片段。';
  if (scopedReady && location.kind === 'collaboration' && !collaborations.some(record => record.id === location.objectId && record.base.nodeId === location.nodeId)) locationError = '无法访问此协作记录。';
  if (scopedReady && location.kind === 'resources' && location.objectId && !location.versionId && !attachments.some(item => item.resourceId === location.objectId) && !manifests.some(manifest => manifest.contextItems.some(item => item.resourceId === location.objectId))) locationError = '无法访问此资源。';
  if (contextHistory?.error && location.kind === 'manifest') locationError = '无法读取此历史上下文。';
  if (contextHistory?.data && location.kind === 'manifest' && (contextHistory.data.manifest.projectId !== currentWorkspaceId || (location.sourceIndex !== undefined && !contextHistory.data.manifest.contextItems[location.sourceIndex]))) locationError = '无法访问此冻结来源。';
  useEffect(() => {
    if (boot !== 'ready' || !scopedReady || ['bootstrap','invalid','chooser','settings'].includes(location.kind)) return;
    if (locationError) { if (location.workspaceId) navigationForget(location.workspaceId, formatLocation(location)); return; }
    if (location.kind === 'manifest' && !contextHistory?.data) return;
    if (location.kind === 'graph' && location.objectId && routeGraphResolved !== formatLocation(location)) return;
    if (location.kind === 'runs' && location.objectId && routeRunResolved !== formatLocation(location)) return;
    if (location.kind === 'resources' && location.versionId) {
      if (resourceRead?.canonical !== formatLocation(location) || resourceRead.loading) return;
      if (!resourceRead.data) { if(location.workspaceId) navigationForget(location.workspaceId,formatLocation(location)); return; }
    }
    navigationRecord(location); if (location.workspaceId) lastLocations.current.set(location.workspaceId, location);
  }, [navigationEntryKey, location, boot, scopedReady, locationError, contextHistory?.data, routeGraphResolved, routeRunResolved, resourceRead, navigationRecord, navigationForget]);
  useEffect(() => {
    if (boot !== 'ready' || !scopedReady || locationError) return;
    const frame = requestAnimationFrame(() => {
      const restoration = navigationRestoration;
      const messageId = location.kind === 'message' ? location.objectId : location.kind === 'segment' ? anchors.find(anchor => anchor.segmentId === location.objectId)?.messageId : undefined;
      const targetId = messageId ? `message-${messageId}` : location.kind === 'collaboration' ? `collaboration-${location.objectId}` : restoration?.anchorId;
      const target = targetId ? document.getElementById(targetId) : undefined;
      if (target) { target.scrollIntoView?.({ block: 'center' }); if (!messageId && restoration?.offset !== undefined) document.querySelector('.conversation')?.scrollBy?.(0, target.getBoundingClientRect().top - restoration.offset); }
      else if (location.kind === 'conversation' && !restoration?.focus && !onboardingOpen) document.querySelector<HTMLTextAreaElement>('[aria-label="输入消息"]')?.focus();
      else if (restoration) { const main = document.querySelector<HTMLElement>('.conversation, #workspace-main'); if (main) main.scrollTop = restoration.scroll; }
      if (restoration?.focus) [...document.querySelectorAll<HTMLElement>('[aria-label]')].find(element => element.getAttribute('aria-label') === restoration.focus && !element.matches(':disabled') && !element.closest('[inert]'))?.focus({preventScroll:true});
    });
    return () => cancelAnimationFrame(frame);
  }, [navigationEntryKey, location, navigationRestoration, boot, scopedReady, locationError, messages, anchors, onboardingOpen]);
  if (boot === 'loading') return <main className="app-loading" aria-busy="true" aria-live="polite"><strong>正在加载工作区…</strong><p>正在同步项目、讨论节点与上下文。</p></main>;
  if (boot === 'error' && location.kind !== 'chooser') return <main className="app-loading" role="alert"><strong>工作区加载失败</strong><p>{bootError}</p><button className="primary-button" onClick={() => void loadWorkspace()}>重试</button><button onClick={() => navigationNavigate({kind:'chooser'})}>选择工作区</button></main>;

  const closeOnboarding = () => { localStorage.setItem('rhiza:onboarding-seen', '1'); setOnboardingOpen(false); };
  const runCommand = (action: () => void) => { setPaletteOpen(false); action(); };
  const resourceSources = location.kind === 'resources' ? manifests.flatMap(manifest => manifest.contextItems.flatMap((item,sourceIndex) => item.resourceId && item.resourceVersionId ? [{resourceId:item.resourceId,versionId:item.resourceVersionId,title:item.title,manifestId:manifest.id,sourceIndex}] : [])) : [];
  const resourceState = resourceRead?.canonical === formatLocation(location) ? resourceRead : undefined;
  const locationTitle = location.kind === 'graph' ? `图谱${routeGraphObject ? ` · ${routeGraphObject.ref.objectType} · ${routeGraphObject.title}` : ''}` : location.detail === 'context' || location.kind === 'manifest' ? `历史上下文${location.sourceIndex !== undefined ? ` · 来源 ${location.sourceIndex + 1}` : ''}` : location.kind === 'message' ? `消息版本 · ${location.objectId?.slice(0,8)}` : location.kind === 'segment' ? segments.find(segment=>segment.id===location.objectId)?.title ?? '片段' : location.kind === 'collaboration' ? '协作记录' : ({state:'知识来源',runs:'执行历史',activity:'活动时间线',resources:'资源',data:'数据与备份',context:'当前上下文',settings:'模型与 API 设置',conversations:'讨论'} as Record<string,string>)[location.kind] ?? '';

  return <AppShell
    view={view}
    navigationSurface={<nav className="workspace-breadcrumbs" aria-label="位置导航"><button onClick={() => navigationCanBack ? window.history.back() : navigationNavigate({kind:'chooser'})}>返回</button><button onClick={() => navigationNavigate({ kind: 'chooser' })}>工作区</button>{location.workspaceId && <button onClick={() => navigationNavigate({ kind: 'workspace', workspaceId: location.workspaceId })}>{scopedReady ? workspaceRecord()?.name ?? '当前工作区' : '工作区'}</button>}{scopedReady && (location.nodeId || location.kind === 'manifest') && activeNode.id && <button aria-label={`讨论：${activeNode.title}`} onClick={() => navigationNavigate({kind:'conversation',workspaceId:currentWorkspaceId,nodeId:activeNode.id})}>{activeNode.title}</button>}<span aria-current="location">{locationTitle}</span><button onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}${window.location.pathname}${formatLocation(location)}`); }}>复制链接</button></nav>}
    primarySurface={location.kind === 'runs' && location.objectId && !locationError && routeRunResolved !== formatLocation(location) ? <main id="workspace-main" className="workspace-empty" aria-busy="true"><h1>正在读取执行记录…</h1></main> : location.kind === 'manifest' && !locationError && !contextHistory?.data ? <main id="workspace-main" className="workspace-empty"><h1>历史上下文</h1><p>正在核实冻结记录…</p></main> : location.kind === 'manifest' && !locationError && !activeNode.id ? <main id="workspace-main" className="workspace-empty"><h1>历史上下文</h1><p>所属讨论当前不可用。此处只展示已授权的冻结来源记录。</p></main> : location.kind === 'graph' && location.objectId && !locationError && routeGraphResolved !== formatLocation(location) ? <main id="workspace-main" className="workspace-empty" aria-busy="true"><h1>正在读取图谱对象…</h1></main> : routeGraphObject && !['conversation','segment','message'].includes(routeGraphObject.ref.objectType) ? <main id="workspace-main" className="workspace landing-view"><h1>{routeGraphObject.title}</h1><p>{routeGraphObject.ref.objectType} · {routeGraphObject.lifecycle}</p><p>此类型当前仅提供图谱元数据。可返回图谱继续浏览。</p></main> : locationError || !scopedReady ? <main id="workspace-main" className="workspace-empty"><h1>{locationError || (syncError ? '无法访问此位置' : '正在加载工作区…')}</h1><p>{scopedReady ? '目标可能已归档、清除或无权访问。可返回原位置或选择工作区。' : syncError}</p><button onClick={() => location.workspaceId && void switchWorkspace(location.workspaceId)}>重新读取</button><button onClick={() => navigationNavigate({ kind: 'chooser' })}>选择工作区</button></main> : ['workspace','conversations','chooser'].includes(location.kind) ? <main id="workspace-main" tabIndex={-1} className="workspace landing-view"><h1>{location.kind === 'chooser' ? '选择工作区' : location.kind === 'conversations' ? '讨论' : workspaceRecord()?.name ?? '工作区'}</h1>{location.kind === 'chooser' ? workspaces.map(item => <button key={item.workspaceId} onClick={() => openWorkspace(item.workspaceId)}>{item.name}{item.status === 'archived' ? ' · 已归档' : ''}</button>) : <><div className="landing-actions"><button onClick={() => setView('graph')}>打开图谱 / 创建讨论</button><button onClick={() => navigationNavigate({ kind:'resources', workspaceId:currentWorkspaceId })}>附件与历史资源</button><button onClick={() => navigationNavigate({ kind:'data', workspaceId:currentWorkspaceId })}>数据与备份</button></div><h2>讨论</h2>{discussionNodes.filter(node => !collaborations.some(record => record.nodeId === node.id)).map(node => <button key={node.id} onClick={() => void activateNode(node.id)}>{node.title}{node.status === 'archived' ? ' · 已归档，只读' : ''}</button>)}<h2>最近访问</h2><button onClick={() => currentWorkspaceId && navigationForget(currentWorkspaceId)}>清空最近访问</button>{navigationRecents.filter(item => item.workspaceId === currentWorkspaceId).map(item => { const target = parseLocation(item.canonicalLocation); const node = discussionNodes.find(node => node.id === target.nodeId); const label = node?.title ?? ({ graph:'对话图谱', context:'当前上下文', manifest:'历史上下文', runs:'执行历史', data:'数据与备份', state:'知识来源', resources:'资源', activity:'活动时间线', workspace:'工作区', conversations:'讨论' } as Record<string,string>)[target.kind]; return label ? <button key={item.canonicalLocation} onClick={() => navigationNavigate(target)}>{label}{target.objectId ? ` · ${target.kind === 'message' ? '消息版本' : target.objectId.slice(0,8)}` : ''}</button> : null; })}</>}</main> : location.kind === 'resources' ? <ResourceView attachments={attachments} sources={resourceSources} resourceId={location.objectId} versionId={location.versionId} data={resourceState?.data} loading={Boolean(location.versionId && (!resourceState || resourceState.loading))} error={resourceState?.error} downloadBusy={resourceDownloadBusy} downloadError={resourceDownloadError} onVersion={(resourceId,versionId) => navigationNavigate({kind:'resources',workspaceId:currentWorkspaceId,objectId:resourceId,versionId})} onManifest={(manifestId,sourceIndex) => navigationNavigate({kind:'manifest',workspaceId:currentWorkspaceId,objectId:manifestId,sourceIndex})} onRetry={() => void readResourceLocation(location)} onDownload={() => void downloadResourceVersion()}/> : undefined}
    hasDiscussionNodes={discussionNodes.length > 0}
    contextOpen={contextOpen && !locationError && scopedReady}
    networkNotice={workspaceRecord()?.status==='archived'?'工作区已归档，可在工作区菜单恢复。':networkNotice}
    onCloseContext={closeContext}
    onOpenContext={() => contextOpen ? closeContext() : openCurrentContext()}
    onView={setView}
    title={view === 'chat' ? (discussionNodes.length ? activeNode.title : '尚无讨论') : ({ graph: '对话图谱', state: '知识状态', activity: '活动时间线', runs: '执行历史' })[view]}
    workspaceName={scopedReady ? workspaceRecord()?.name : '工作区'}
    contextCount={previewLoading ? undefined : activeCount}
    sidebar={<Sidebar view={view} nodes={navigableNodes.filter(node => !collaborations.some(record => record.nodeId === node.id))} messages={messages} activeNodeId={activeNode.id} onView={setView} onNode={id => activateNode(id, true)} onSettings={openSettings} onCommand={() => setPaletteOpen(true)} onHelp={() => setOnboardingOpen(true)} workspaces={workspaces} currentWorkspaceId={currentWorkspaceId} onWorkspace={openWorkspace} onCreateWorkspace={() => setWorkspaceForm('create')} onRenameWorkspace={() => setWorkspaceForm('rename')} onArchiveWorkspace={() => void archiveWorkspace()} onRestoreWorkspace={() => void restoreWorkspace()} onData={() => navigationNavigate({ kind: 'data', workspaceId: currentWorkspaceId })}/>}
    emptySurface={<main id="workspace-main" className="workspace-empty"><h1>这个工作区还没有讨论节点</h1><p>请通过项目入口创建第一个节点，然后开始建立上下文。</p></main>}
    surfaces={{
      chat: <ChatView
        key={`${currentWorkspaceId}:${activeNode.id}`} focusMessageId={location.kind === 'message' ? location.objectId : location.kind === 'segment' ? anchors.find(anchor => anchor.segmentId === location.objectId)?.messageId : undefined} provenanceMessageId={location.kind === 'message' && location.detail === 'provenance' ? location.objectId : undefined} readOnly={locationReadOnly} activeNode={activeNode} nodes={navigableNodes} edges={discussionEdges} mode={mode}
        collaborations={collaborations.filter(record => record.base.nodeId === activeNode.id)} collaborationBusy={collaborationBusy} collaborationError={collaborationError} collaborationStreams={collaborationStreams} onContinue={viewedNodeId !== activeNodeId && !locationReadOnly ? () => void ensureExecutionNode().catch(error => setSyncError(presentErrorText(error,{message:'无法继续此讨论。',recovery:'请重新读取后重试。'}))) : undefined} onStartCollaboration={viewedNodeId === activeNodeId && !locationReadOnly ? startCollaboration : undefined} onCollaborationAction={locationReadOnly ? undefined : changeCollaboration} onStopCollaboration={locationReadOnly ? undefined : record => void stopCollaboration(record)}
        onInspectProvenance={id => navigationNavigate({kind:'message',workspaceId:currentWorkspaceId,nodeId:activeNode.id,objectId:id,detail:'provenance'})} onDraftChange={updateDraftContext} onInspectManifest={id => void inspectMessageContext('', id)} onOpenRun={id => navigationNavigate({ kind: 'runs', workspaceId: currentWorkspaceId, objectId: id })}
        activeCount={activeCount} messages={activeMessages} manifests={manifests} attachments={attachments}
        segments={segments} anchors={anchors} onWorkspaceChanged={applyWorkspace} onReconcile={()=>void loadWorkspace(true)} onRetry={async(runId,key,signal)=>{const current=workspaceMutation();const result=await api.retryRun(runId,key,signal);if(current()){setMessages(messages=>[...messages,result.userMessage,result.assistantMessage]);setManifests(manifests=>[...manifests,result.manifest]);}}} provider={provider} providerCatalog={{...providerCatalog,activeModelId:activeNode.preferredModelId??workspaceModelId??providerCatalog.activeModelId}} syncError={syncError} online={online&&workspaceRecord()?.status!=='archived'} focusComposerRequest={focusComposerRequest} onSend={sendMessage}
        onUpload={uploadAttachment} onTempSend={sendTemporaryMessage} onCreateBranch={createBranch}
        onActivateNode={id => activateNode(id)} onMerge={mergeNode} onSelectModel={async modelId=>{const current=workspaceMutation();const {workspace}=await api.setConversationModel(activeNode.id,modelId);if(current())applyWorkspace(workspace);}}
        onSettings={openSettings} onOpenContext={() => contextOpen ? closeContext() : openCurrentContext()} onInspectContext={id => void inspectMessageContext(id)} onGraph={() => setView('graph')} onRuns={() => setView('runs')}
      />,
      graph: <GraphView contextBusy={trayBusy} onContextSelectionChange={() => { trayRequest.current++;setTrayPreview(undefined);setTrayBusy(false);setTrayError('');setTrayNotice(''); }} displayFilters={location.kind==='graph' && !location.objectId ? location.graphFilters ?? {} : undefined} onShareFilters={shareGraphFilters} onPreviewContext={previewTray} contextTray={<GraphContextTray targetTitle={discussionNodes.find(node=>node.id===activeNodeId)?.title ?? '当前讨论'} preview={trayPreview} busy={trayBusy} readOnly={workspaceRecord()?.status==='archived'} error={trayError} notice={trayNotice} onConfirm={() => void confirmTray()} onRefresh={() => void previewTray()} onClose={() => { trayRequest.current++; setTrayPreview(undefined);setTrayBusy(false);setTrayError('');setTrayNotice(''); }}/>} readOnly={workspaceRecord()?.status === 'archived'} key={currentWorkspaceId} initialPresentation={navigationRestoration?.graph as GraphNavigationPresentation | undefined} onPresentationChange={navigationRememberGraph} focusedObjectId={location.kind === 'graph' ? location.objectId : undefined} onInspectObject={node => navigationNavigate({kind:'graph',workspaceId:currentWorkspaceId,objectType:node.objectType ?? 'conversation',objectId:node.id},true)} personalView={graphPersonal} personalLoading={personalLoading} onSavePersonal={saveGraphPresentation} onReloadPersonal={() => void loadPersonalView()} batch={graphBatch} batchBusy={batchBusy} batchError={batchError} onBatch={(ids, operation, relation) => runGraphBatch('apply', { ids, operation, relation })} onResumeBatch={() => void runGraphBatch('resume')} onReadBatch={() => void runGraphBatch('read')} onUndoBatch={() => void runGraphBatch('undo')} loading={graphLoading} error={graphError} hasMore={!!graphProjection?.nextCursor} onLoadMore={() => void loadGraph(graphProjection?.nextCursor)} onRefresh={() => void loadGraph()} onFilter={filterGraph} onNeighborhood={loadGraphNeighborhood} contextIds={contextItems.filter(item=>item.status==='active').map(item=>item.sourceId??'')} onContext={async(node,remove)=>{if(remove){const item=contextItems.find(item=>item.sourceId===node.id);if(item)await updateStatus(item.id,'excluded');}else await addContextSource(node.objectType==='segment'?'segment':'node',node.id);}} onNavigateObject={async node => { const message = messages.find(item => item.id === node.id); const segment = segments.find(item => item.id === node.id); if (message) navigationNavigate({ kind: 'message', workspaceId: currentWorkspaceId, nodeId: message.nodeId, objectId: message.id }); else if (segment) navigationNavigate({ kind: 'segment', workspaceId: currentWorkspaceId, nodeId: segment.nodeId, objectId: segment.id }); else setRouteReadError('无法访问此位置。'); }} onPath={highlightGraphPath} nodes={graphModel.nodes} edges={graphModel.edges} activeNodeId={activeNode.id} onMove={moveNode} onActivate={id => activateNode(id, true)} onCreateNode={createGraphNode} onArchiveNode={archiveGraphNode} onRestoreNode={restoreGraphNode} onPurgeNode={purgeGraphNode} onCreateEdge={createGraphEdge} onDeleteEdge={deleteGraphEdge}/>,
      state: <StateView items={contextItems} onSource={item => { if (item.sourceType === 'node') void activateNode(item.sourceId!); else if (item.sourceType === 'segment') navigationNavigate({ kind: 'segment', workspaceId: currentWorkspaceId, nodeId: segments.find(segment => segment.id === item.sourceId)?.nodeId ?? item.sourceNodeId, objectId: item.sourceId }); else navigationNavigate({ kind: 'resources', workspaceId: currentWorkspaceId }); }}/>,
      runs: <RunHistory key={currentWorkspaceId} focusedRun={focusedRun} onRefreshFocused={location.objectId ? () => readRunLocation(location) : undefined} readOnly={workspaceRecord()?.status === 'archived'} onInspectContext={id => void inspectMessageContext('', id)} onChanged={() => void loadWorkspace(true).then(() => readRunLocation(location))}/>,
      activity: <ActivityView activity={activity} loading={activityLoading} error={activityError} onRefresh={() => void loadActivity()}/>,
    }}
    contextSurface={location.kind === 'context' && viewedNodeId !== activeNodeId ? <aside className="context-panel"><h2>当前执行上下文</h2><p>当前浏览讨论尚未成为执行讨论。</p><button onClick={() => void ensureExecutionNode().catch(error => setSyncError(presentErrorText(error,{message:'无法继续讨论。',recovery:'请重新读取后重试。'})))}>继续此讨论</button></aside> : <ContextPanel readOnly={locationReadOnly} key={currentWorkspaceId} preview={contextPreview} loading={previewLoading} error={previewError} deciding={decidingContext} onRefresh={() => setPreviewRevision(value => value + 1)} onDecision={decideContext} onClose={closeContext} history={contextHistory ? {...contextHistory,sourceIndex:location.kind==='manifest'?location.sourceIndex:undefined} : undefined} onResourceVersion={(resourceId,versionId) => navigationNavigate({kind:'resources',workspaceId:currentWorkspaceId,objectId:resourceId,versionId})} onSelectHistorySource={index => navigationNavigate({kind:'manifest',workspaceId:currentWorkspaceId,objectId:contextHistory?.data?.manifest.id,sourceIndex:index})} onBackToCurrent={openCurrentContext} onRetryHistory={() => { if (contextHistory) void readMessageContext(contextHistory.messageId, contextHistory.manifestId); }} items={contextItems} mode={mode} nodes={discussionNodes} segments={segments} attachments={attachments} onMode={updateMode} onStatus={updateStatus} onPin={updatePin} onAddSource={addContextSource}/>}
    overlayLayer={<>
      {workspaceForm&&<WorkspaceForm key={currentWorkspaceId} rename={workspaceForm==='rename'} initialName={workspaceForm==='rename'?workspaceRecord()?.name:undefined} onSave={workspaceForm==='rename'?renameWorkspace:createWorkspace} onClose={()=>setWorkspaceForm(undefined)}/>}
      {mergeSource&&discussionNodes.find(node=>node.id===mergeSource)&&<MergeDialog source={discussionNodes.find(node=>node.id===mergeSource)!} nodes={discussionNodes} latestReply={[...messages].reverse().find(message=>message.nodeId===mergeSource&&message.kind==='assistant')?.text??''} onClose={()=>setMergeSource(undefined)} onSave={async(targetNodeId,summary)=>{const current=workspaceMutation();const {workspace}=await api.mergeNode(mergeSource,targetNodeId,summary);if(current())applyWorkspace(workspace);}}/>}

      {dataOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeData(); }}><section className="workspace-data-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-data-title"><header><div><h2 id="workspace-data-title">数据与备份</h2><p>{workspaceRecord()?.name ?? '当前工作区'} · {currentWorkspaceId}</p></div><button aria-label="关闭数据与备份" onClick={closeData}>×</button></header><BundleControls key={currentWorkspaceId} workspaceId={currentWorkspaceId} catalog={providerCatalog} backups={backups} backupsLoading={backupsLoading} backupsError={backupsError} onRefreshBackups={() => void refreshBackups()} onSettings={() => { setDataOpen(false); void openSettings(); }} onPreview={api.previewWorkspaceBundle} onHydrate={api.hydrateWorkspaceBundle} onBackupArchive={api.getManagedBackupArchive} onBackup={async (key, retryOf) => { const scope = selectedWorkspaceRef.current; await api.createManagedBackup(key, retryOf); if (scope === selectedWorkspaceRef.current) await refreshBackups(); }} onImport={async (file, key, mappings) => {
          const result = await api.importWorkspaceBundle(file, key, mappings);
          void refreshWorkspaces().catch(() => setSyncError('归档已导入，工作区列表刷新失败，请重新加载列表。'));
          return result;
        }} onReadImported={async workspaceId => {
          const { workspace } = await api.getScopedWorkspace(workspaceId);
          if (workspace.projectId !== workspaceId) throw new Error('导入后的工作区身份不匹配。');
          const current = workspace.discussionNodes.find(node => node.id === workspace.activeNodeId);
          return { activeNodeId: current?.id, activeNodeTitle: current?.title, canApply: !current || current.status === 'active' };
        }} onApplyModel={async (workspaceId, modelId, key, nodeId) => {
          const options = { workspaceId, idempotencyKey: key };
          const { workspace } = await (nodeId ? api.setConversationModel(nodeId, modelId, options) : api.setWorkspaceModel(modelId, options));
          if (workspace.projectId !== workspaceId) throw new Error('模型偏好的工作区身份不匹配。');
        }} onOpenImported={async workspaceId => {
          const scope = selectedWorkspaceRef.current;
          await refreshWorkspaces();
          if (scope === selectedWorkspaceRef.current) navigationNavigate({ kind:'workspace', workspaceId });
        }}/></section></div>}
      {settingsOpen && <ProviderSettings catalog={providerCatalog} presets={providerPresets} onClose={closeSettings} onSave={saveProvider} onDiscover={discoverModels} onDiscoverBatch={discoverProviderBatch} onToggleModel={updateModel} onSelectModel={selectModel}/>}
      {paletteOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPaletteOpen(false); }}><section ref={activeModalRef} className="command-palette" role="dialog" aria-modal="true" aria-label="命令面板"><header><strong>搜索或运行命令</strong><kbd>Esc</kbd></header><WorkspaceSearch key={currentWorkspaceId} onOpen={async (nodeId, segmentId) => { navigationNavigate(segmentId ? { kind: 'segment', workspaceId: currentWorkspaceId, nodeId, objectId: segmentId } : { kind: 'conversation', workspaceId: currentWorkspaceId, nodeId }); setPaletteOpen(false); }}/><label>工作区默认模型<select value={workspaceModelId??''} onChange={event=>{const current=workspaceMutation();void api.setWorkspaceModel(event.target.value||null).then(({workspace})=>{if(current())applyWorkspace(workspace);}).catch(()=>setSyncError('工作区模型保存失败，请重试。'));}}><option value="">继承全局默认模型</option>{providerCatalog.models.map(model=><option key={model.id} value={model.id}>{model.displayName}</option>)}</select></label><details><summary>已归档讨论</summary>{discussionNodes.filter(node=>node.status==='archived').map(node=><div key={node.id}>{node.title}<button onClick={()=>void restoreGraphNode(node.id)}>恢复讨论</button></div>)}</details><button onClick={() => runCommand(() => setView('chat'))}>当前讨论 <kbd>⌘1</kbd></button><button onClick={() => runCommand(() => setView('graph'))}>对话图谱 <kbd>⌘2</kbd></button><button onClick={() => runCommand(() => setView('state'))}>知识状态 <kbd>⌘3</kbd></button><button onClick={() => runCommand(() => setView('activity'))}>活动时间线 <kbd>⌘4</kbd></button><button onClick={() => runCommand(openCurrentContext)}>打开 Context <kbd>⌘⇧C</kbd></button><button onClick={() => runCommand(() => { setView('chat'); setFocusComposerRequest(value => value + 1); })}>聚焦消息输入框 <kbd>/</kbd></button><button onClick={() => runCommand(() => setOnboardingOpen(true))}>帮助与快捷键</button></section></div>}
      {onboardingOpen && <div className="dialog-backdrop" role="presentation"><section ref={activeModalRef} className="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title"><h2 id="onboarding-title">欢迎来到 Rhiza</h2><p>用四个对象把研究和决策留在同一个工作区：</p><dl><div><dt>Project</dt><dd>一个完整的研究或决策空间。</dd></div><div><dt>Node</dt><dd>围绕一个问题持续展开的讨论。</dd></div><div><dt>Graph</dt><dd>展示讨论之间的衍生、引用和合并关系。</dd></div><div><dt>Context</dt><dd>明确控制本轮发送给模型的材料。</dd></div></dl><button className="primary-button" autoFocus onClick={closeOnboarding}>开始使用</button></section></div>}
    </>}
  />;
}
