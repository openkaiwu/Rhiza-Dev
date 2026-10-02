import { BundleControls } from './components/BundleControls';
import { WorkspaceForm } from './components/WorkspaceForm';
import { WorkspaceSearch } from './components/WorkspaceSearch';
import { MergeDialog } from './components/MergeDialog';
import { boundedGraphCache } from './components/graph-viewport';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Anchor, Attachment, ContextManifest, ContextMode, ContextPreview, ContextRecommendationDecision, CollaborationInput, CollaborationRecord, ContextStatus, DiscussionEdge, DiscussionNode, GraphProjectionResult, Message, GraphBatchItem, GraphBatchResult, GraphViewInput, PersonalGraphView, ManagedBackupList, ProviderCatalog, ProviderPresetInfo, ProviderStatus, Segment, View, WorkspaceActivityItem, WorkspaceSnapshot, WorkspaceRecord } from './types';
import { api, type ChatRequestOptions } from './api';
import { presentErrorText } from './error-presentation';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { GraphView } from './components/GraphView';
import { StateView } from './components/StateView';
import type { ContextHistoryState } from './components/ContextHistoryPanel';
import { ContextPanel } from './components/ContextPanel';
import { ProviderSettings, type ProviderFormState } from './components/ProviderSettings';
import { RunHistory } from './components/RunHistory';
import { ActivityView } from './components/ActivityView';
import { AppShell } from './components/AppShell';
import { projectionToGraphPresentationModel, toGraphPresentationModel, toGraphPersonalPresentation, type GraphPersonalPresentation, type GraphRelation } from './components/graph-model';

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
  const [focusedRunId, setFocusedRunId] = useState<string>();
  const [collaborations, setCollaborations] = useState<CollaborationRecord[]>([]);
  const [collaborationError, setCollaborationError] = useState('');
  const [collaborationBusy, setCollaborationBusy] = useState('');
  const [collaborationStreams, setCollaborationStreams] = useState<Record<string, { participantId: string; round: number; text: string }>>({});
  const collaborationController = useRef<AbortController | undefined>(undefined);
  const collaborationKeys = useRef(new Map<string, string>());
  const collaborationScope = useRef(0);

  const closeContext = useCallback(() => setContextOpen(false), []);
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
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string>();
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
  const personalSaving = useRef(false);
  const personalSaveKeys = useRef(new Map<string, string>());
  const [graphBatch, setGraphBatch] = useState<GraphBatchResult>();
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState('');
  const batchRunning = useRef(false);
  const batchInputRef = useRef<{ workspaceId?: string; items: GraphBatchItem[]; key: string } | undefined>(undefined);
  const batchUndoKeys = useRef(new Map<string, string>());
  const batchUndoRef = useRef<{ workspaceId?: string; batchId: string; key: string } | undefined>(undefined);

  const graphFiltersRef=useRef<{query?:string;statuses?:string[];updatedAfter?:string}>({});
  const graphRequestRef = useRef(0);
  const graphPagesRef = useRef(1);
  const graphCompleteRef = useRef(false);
  const workspaceGenerationRef = useRef(0);
  const selectedWorkspaceRef = useRef<string | undefined>(undefined);
  const modalReturnFocusRef = useRef<HTMLElement | null>(null);
  const activeModalRef = useRef<HTMLElement | null>(null);

  const applyWorkspace = useCallback((workspace: WorkspaceSnapshot) => {
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
    return () => { collaborationScope.current += 1; collaborationController.current?.abort(); collaborationController.current = undefined; };
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
  const filterGraph=useCallback((filters:{query?:string;statuses?:string[];updatedAfter?:string})=>{if(JSON.stringify(filters)===JSON.stringify(graphFiltersRef.current))return;graphFiltersRef.current=filters;graphPagesRef.current=1;graphCompleteRef.current=false;void loadGraph();},[loadGraph]);
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
    const scope = selectedWorkspaceRef.current; const request = ++personalRequestRef.current;
    setPersonalLoading(true);
    try { const result = await api.getPersonalGraphView(); if (scope === selectedWorkspaceRef.current && request === personalRequestRef.current) { personalViewRef.current = result; setPersonalView(result); } }
    catch (error) { if (scope === selectedWorkspaceRef.current && request === personalRequestRef.current) setGraphError(presentErrorText(error, { message: '无法读取个人视图。', recovery: '请重新读取后再保存。' })); }
    finally { if (scope === selectedWorkspaceRef.current && request === personalRequestRef.current) setPersonalLoading(false); }
  }, []);
  useEffect(() => { personalRequestRef.current++; personalViewRef.current = undefined; setPersonalView(undefined); setGraphBatch(undefined); setBatchError(''); batchInputRef.current = undefined; batchUndoRef.current = undefined; setBatchBusy(false); }, [currentWorkspaceId]);
  useEffect(() => { if (view === 'graph' && boot === 'ready') void loadPersonalView(); }, [view, boot, currentWorkspaceId, loadPersonalView]);
  const savePersonalInput = async (input: GraphViewInput) => {
    const original = personalViewRef.current; const scope = selectedWorkspaceRef.current;
    if (!original || personalSaving.current) throw new Error('个人视图尚未就绪或保存仍在进行。');
    const identity = JSON.stringify([scope, original.revision, input]); const key = personalSaveKeys.current.get(identity) ?? crypto.randomUUID(); personalSaveKeys.current.set(identity, key);
    personalSaving.current = true;
    try { const receipt = await api.savePersonalGraphView(input, original.revision, key); if (scope !== selectedWorkspaceRef.current) return; const next = { ...original, ...input, ...receipt, source: 'personal' as const }; personalViewRef.current = next; setPersonalView(next); personalSaveKeys.current.delete(identity); }
    finally { personalSaving.current = false; }
  };
  const saveGraphPresentation = async (presentation: GraphPersonalPresentation) => {
    const original = personalViewRef.current; if (!original) throw new Error('请先读取个人视图。');
    const changes = new Map(Object.entries(presentation.positions).map(([objectId, position]) => [objectId, { objectId, ...position, objectType: graphProjection?.objects.find(item => item.ref.objectId === objectId)?.ref.objectType ?? 'conversation', collapsed: presentation.collapsedIds.includes(objectId) }]));
    const positions = [...original.positions.filter(item => !changes.has(item.objectId)), ...changes.values()] as PersonalGraphView['positions'];
    await savePersonalInput({ positions, viewport: presentation.viewport ? { x: presentation.viewport.x, y: presentation.viewport.y, zoom: presentation.viewport.scale } : original.viewport, filters: { ...original.filters, relationTypes: presentation.relationFilter ? [presentation.relationFilter.replaceAll('-', '_')] : [] } });
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
  const openCurrentContext = () => { historyRequestRef.current++; setContextHistory(undefined); setContextOpen(true); };
  const inspectMessageContext = async (messageId: string, manifestId?: string) => {
    const request = ++historyRequestRef.current;
    const generation = workspaceGenerationRef.current;
    setContextOpen(true); setContextHistory({ messageId, manifestId, loading: true });
    try {
      const data = await (manifestId ? api.getManifestContext(manifestId) : api.getMessageContext(messageId));
      if (request === historyRequestRef.current && generation === workspaceGenerationRef.current) setContextHistory({ messageId, manifestId, loading: false, data });
    } catch (error) {
      if (request === historyRequestRef.current && generation === workspaceGenerationRef.current) setContextHistory({ messageId, manifestId, loading: false, error: presentErrorText(error, { message: '无法读取这轮上下文。', recovery: '请重新加载。' }) });
    }
  };
  const switchWorkspace = async (workspaceId: string) => {
    setDataOpen(false);
    historyRequestRef.current++; setContextHistory(undefined);
    setContextPreview(undefined); setPreviewError(''); setDecidingContext(false); setFocusedRunId(undefined);
    const generation = ++workspaceGenerationRef.current;
    selectedWorkspaceRef.current = workspaceId;
    graphRequestRef.current += 1; graphPagesRef.current = 1; graphCompleteRef.current = false; setGraphProjection(undefined); setGraphError('');
    setMessages([]); setDiscussionNodes([]); setContextItems([]); setAttachments([]); setDiscussionEdges([]); setSegments([]); setManifests([]); setActivity([]); setActiveNodeId('');
    graphFiltersRef.current={}; graphDetailKeys.current.clear();setAnchors([]);
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
  const createWorkspace = async (name:string) => { const current=workspaceMutation();const {workspace}=await api.createWorkspace(name);if(!current())return;await refreshWorkspaces();if(current())await switchWorkspace(workspace.workspaceId); };
  const workspaceRecord = () => workspaces.find(item => item.workspaceId === currentWorkspaceId);
  const renameWorkspace = async (name:string) => { const current=workspaceMutation();const record=workspaceRecord();if(!record)return;await api.updateWorkspace(record.workspaceId,'rename',record.revision,name);if(current())await refreshWorkspaces(); };
  const archiveWorkspace = async () => { const current = workspaceMutation(); const record = workspaceRecord(); if (!record) return; await api.updateWorkspace(record.workspaceId, 'archive', record.revision); if (!current()) return; const items = await refreshWorkspaces(); if (!current()) return; const next = items.find(item => item.workspaceId !== record.workspaceId && item.status === 'active'); if (next) await switchWorkspace(next.workspaceId); };
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
      if (dataOpen) {
        if (event.key === 'Escape') setDataOpen(false);
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
  }, [onboardingOpen, paletteOpen, settingsOpen, dataOpen]);
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
  const sendTemporaryMessage = async (input: { sourceNodeId: string; anchorText: string; message: string; history: Array<Pick<Message, 'kind' | 'text'>> },onEvent?: Parameters<typeof api.streamTemporaryMessage>[1],options?: ChatRequestOptions) => api.streamTemporaryMessage(input,onEvent??(()=>undefined),options);
  const activateNode = async (id: string, openChat = false) => {
    const current = workspaceMutation();
    const { workspace } = await api.activateNode(id);
    if (!current()) return;
    applyWorkspace(workspace);
    if (openChat) setView('chat');
  };
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
    const current = workspaceMutation();
    const { workspace } = await api.purgeGraphNode(id, confirmation, reason);
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
  const mergeNode = async (id:string) => { setMergeSource(id); };
  const activeCount = contextPreview?.items.length ?? 0;
  const navigableNodes = discussionNodes.filter(node => node.status !== 'archived' && !collaborations.some(record => record.nodeId === node.id));
  const activeNode = navigableNodes.find(node => node.id === activeNodeId) || navigableNodes[0] || initialNode;
  const activeMessages = messages.filter(message => message.nodeId === activeNode.id);
  const graphModel = useMemo(
    () => {
      const model = graphProjection ? projectionToGraphPresentationModel(graphProjection) : toGraphPresentationModel([], []);
      const internalIds = new Set(collaborations.map(record => record.nodeId));
      return { nodes: model.nodes.filter(node => !internalIds.has(node.id)), edges: model.edges.filter(edge => !internalIds.has(edge.source) && !internalIds.has(edge.target)) };
    },
    [graphProjection, collaborations],
  );

  const graphPersonal = useMemo(() => personalView ? toGraphPersonalPresentation(personalView) : undefined, [personalView]);
  if (boot === 'loading') return <main className="app-loading" aria-busy="true" aria-live="polite"><strong>正在加载工作区…</strong><p>正在同步项目、讨论节点与上下文。</p></main>;
  if (boot === 'error') return <main className="app-loading" role="alert"><strong>工作区加载失败</strong><p>{bootError}</p><button className="primary-button" onClick={() => void loadWorkspace()}>重试</button></main>;

  const closeOnboarding = () => { localStorage.setItem('rhiza:onboarding-seen', '1'); setOnboardingOpen(false); };
  const runCommand = (action: () => void) => { setPaletteOpen(false); action(); };

  return <AppShell
    view={view}
    hasDiscussionNodes={discussionNodes.length > 0}
    contextOpen={contextOpen}
    networkNotice={workspaceRecord()?.status==='archived'?'工作区已归档，可在工作区菜单恢复。':networkNotice}
    onCloseContext={closeContext}
    onOpenContext={() => { if (contextHistory) openCurrentContext(); else setContextOpen(open => !open); }}
    onView={setView}
    title={view === 'chat' ? (discussionNodes.length ? activeNode.title : '尚无讨论') : ({ graph: '对话图谱', state: '知识状态', activity: '活动时间线', runs: '执行历史' })[view]}
    workspaceName={workspaceRecord()?.name}
    contextCount={previewLoading ? undefined : activeCount}
    sidebar={<Sidebar view={view} nodes={navigableNodes.filter(node => !collaborations.some(record => record.nodeId === node.id))} messages={messages} activeNodeId={activeNode.id} onView={setView} onNode={id => activateNode(id, true)} onSettings={openSettings} onCommand={() => setPaletteOpen(true)} onHelp={() => setOnboardingOpen(true)} workspaces={workspaces} currentWorkspaceId={currentWorkspaceId} onWorkspace={id => void switchWorkspace(id)} onCreateWorkspace={() => setWorkspaceForm('create')} onRenameWorkspace={() => setWorkspaceForm('rename')} onArchiveWorkspace={() => void archiveWorkspace()} onRestoreWorkspace={() => void restoreWorkspace()} onData={() => { setContextOpen(false); setDataOpen(true); }}/>}
    emptySurface={<main id="workspace-main" className="workspace-empty"><h1>这个工作区还没有讨论节点</h1><p>请通过项目入口创建第一个节点，然后开始建立上下文。</p></main>}
    surfaces={{
      chat: <ChatView
        key={`${currentWorkspaceId}:${activeNode.id}`} activeNode={activeNode} nodes={navigableNodes} edges={discussionEdges} mode={mode}
        collaborations={collaborations.filter(record => record.base.nodeId === activeNode.id)} collaborationBusy={collaborationBusy} collaborationError={collaborationError} collaborationStreams={collaborationStreams} onStartCollaboration={startCollaboration} onCollaborationAction={changeCollaboration} onStopCollaboration={record => void stopCollaboration(record)}
        onDraftChange={updateDraftContext} onInspectManifest={id => void inspectMessageContext('', id)} onOpenRun={id => { setFocusedRunId(id); setView('runs'); }}
        activeCount={activeCount} messages={activeMessages} manifests={manifests} attachments={attachments}
        segments={segments} anchors={anchors} onWorkspaceChanged={applyWorkspace} onReconcile={()=>void loadWorkspace(true)} onRetry={async(runId,key,signal)=>{const current=workspaceMutation();const result=await api.retryRun(runId,key,signal);if(current()){setMessages(messages=>[...messages,result.userMessage,result.assistantMessage]);setManifests(manifests=>[...manifests,result.manifest]);}}} provider={provider} providerCatalog={{...providerCatalog,activeModelId:activeNode.preferredModelId??workspaceModelId??providerCatalog.activeModelId}} syncError={syncError} online={online&&workspaceRecord()?.status!=='archived'} focusComposerRequest={focusComposerRequest} onSend={sendMessage}
        onUpload={uploadAttachment} onTempSend={sendTemporaryMessage} onCreateBranch={createBranch}
        onActivateNode={id => activateNode(id, true)} onMerge={mergeNode} onSelectModel={async modelId=>{const current=workspaceMutation();const {workspace}=await api.setConversationModel(activeNode.id,modelId);if(current())applyWorkspace(workspace);}}
        onSettings={openSettings} onOpenContext={() => { if (contextHistory) openCurrentContext(); else setContextOpen(open => !open); }} onInspectContext={id => void inspectMessageContext(id)} onGraph={() => setView('graph')} onRuns={() => setView('runs')}
      />,
      graph: <GraphView key={currentWorkspaceId} personalView={graphPersonal} personalLoading={personalLoading} onSavePersonal={saveGraphPresentation} onReloadPersonal={() => void loadPersonalView()} batch={graphBatch} batchBusy={batchBusy} batchError={batchError} onBatch={(ids, operation, relation) => runGraphBatch('apply', { ids, operation, relation })} onResumeBatch={() => void runGraphBatch('resume')} onReadBatch={() => void runGraphBatch('read')} onUndoBatch={() => void runGraphBatch('undo')} loading={graphLoading} error={graphError} hasMore={!!graphProjection?.nextCursor} onLoadMore={() => void loadGraph(graphProjection?.nextCursor)} onRefresh={() => void loadGraph()} onFilter={filterGraph} onNeighborhood={loadGraphNeighborhood} contextIds={contextItems.filter(item=>item.status==='active').map(item=>item.sourceId??'')} onContext={async(node,remove)=>{if(remove){const item=contextItems.find(item=>item.sourceId===node.id);if(item)await updateStatus(item.id,'excluded');}else await addContextSource(node.objectType==='segment'?'segment':'node',node.id);}} onNavigateObject={async node=>{let parent=node.parentId;const parentObject=graphProjection?.objects.find(item=>item.ref.objectId===parent);if(parentObject?.ref.objectType==='segment')parent=graphProjection?.relations.find(edge=>edge.relationType==='contains'&&edge.target.objectId===parent)?.source.objectId;if(parent)await activateNode(parent,true);const message=node.objectType==='message'?node.id:anchors.find(anchor=>anchor.segmentId===node.id)?.messageId??messages.find(message=>message.segmentId===node.id)?.id;if(message)setTimeout(()=>document.getElementById(`message-${message}`)?.scrollIntoView({block:'center'}),50);}} onPath={highlightGraphPath} nodes={graphModel.nodes} edges={graphModel.edges} activeNodeId={activeNode.id} onMove={moveNode} onActivate={id => activateNode(id, true)} onCreateNode={createGraphNode} onArchiveNode={archiveGraphNode} onRestoreNode={restoreGraphNode} onPurgeNode={purgeGraphNode} onCreateEdge={createGraphEdge} onDeleteEdge={deleteGraphEdge}/>,
      state: <StateView/>,
      runs: <RunHistory key={currentWorkspaceId} focusedRunId={focusedRunId} onInspectContext={id => void inspectMessageContext('', id)} onChanged={() => void loadWorkspace(true)}/>,
      activity: <ActivityView activity={activity} loading={activityLoading} error={activityError} onRefresh={() => void loadActivity()}/>,
    }}
    contextSurface={<ContextPanel key={currentWorkspaceId} preview={contextPreview} loading={previewLoading} error={previewError} deciding={decidingContext} onRefresh={() => setPreviewRevision(value => value + 1)} onDecision={decideContext} onClose={closeContext} history={contextHistory} onBackToCurrent={openCurrentContext} onRetryHistory={() => { if (contextHistory) void inspectMessageContext(contextHistory.messageId, contextHistory.manifestId); }} items={contextItems} mode={mode} nodes={discussionNodes} segments={segments} attachments={attachments} onMode={updateMode} onStatus={updateStatus} onPin={updatePin} onAddSource={addContextSource}/>}
    overlayLayer={<>
      {workspaceForm&&<WorkspaceForm key={currentWorkspaceId} rename={workspaceForm==='rename'} initialName={workspaceForm==='rename'?workspaceRecord()?.name:undefined} onSave={workspaceForm==='rename'?renameWorkspace:createWorkspace} onClose={()=>setWorkspaceForm(undefined)}/>}
      {mergeSource&&discussionNodes.find(node=>node.id===mergeSource)&&<MergeDialog source={discussionNodes.find(node=>node.id===mergeSource)!} nodes={discussionNodes} latestReply={[...messages].reverse().find(message=>message.nodeId===mergeSource&&message.kind==='assistant')?.text??''} onClose={()=>setMergeSource(undefined)} onSave={async(targetNodeId,summary)=>{const current=workspaceMutation();const {workspace}=await api.mergeNode(mergeSource,targetNodeId,summary);if(current())applyWorkspace(workspace);}}/>}

      {dataOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setDataOpen(false); }}><section className="workspace-data-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-data-title"><header><div><h2 id="workspace-data-title">数据与备份</h2><p>{workspaceRecord()?.name ?? '当前工作区'} · {currentWorkspaceId}</p></div><button aria-label="关闭数据与备份" onClick={() => setDataOpen(false)}>×</button></header><BundleControls key={currentWorkspaceId} workspaceId={currentWorkspaceId} catalog={providerCatalog} backups={backups} backupsLoading={backupsLoading} backupsError={backupsError} onRefreshBackups={() => void refreshBackups()} onSettings={() => { setDataOpen(false); void openSettings(); }} onPreview={api.previewWorkspaceBundle} onHydrate={api.hydrateWorkspaceBundle} onBackupArchive={api.getManagedBackupArchive} onBackup={async (key, retryOf) => { const scope = selectedWorkspaceRef.current; await api.createManagedBackup(key, retryOf); if (scope === selectedWorkspaceRef.current) await refreshBackups(); }} onImport={async (file, key, mappings) => { const scope = selectedWorkspaceRef.current; const result = await api.importWorkspaceBundle(file, key, mappings); if (scope !== selectedWorkspaceRef.current) return; await refreshWorkspaces(); if (scope === selectedWorkspaceRef.current) { await switchWorkspace(result.workspaceId); setView('chat'); } }}/></section></div>}
      {settingsOpen && <ProviderSettings catalog={providerCatalog} presets={providerPresets} onClose={() => setSettingsOpen(false)} onSave={saveProvider} onDiscover={discoverModels} onDiscoverBatch={discoverProviderBatch} onToggleModel={updateModel} onSelectModel={selectModel}/>}
      {paletteOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPaletteOpen(false); }}><section ref={activeModalRef} className="command-palette" role="dialog" aria-modal="true" aria-label="命令面板"><header><strong>搜索或运行命令</strong><kbd>Esc</kbd></header><WorkspaceSearch key={currentWorkspaceId} onOpen={async(nodeId,segmentId,query)=>{await activateNode(nodeId,true);setPaletteOpen(false);const message=segmentId?messages.find(message=>message.segmentId===segmentId):messages.find(message=>message.nodeId===nodeId&&message.text.toLocaleLowerCase().includes(query?.toLocaleLowerCase()??''));if(message)setTimeout(()=>document.getElementById(`message-${message.id}`)?.scrollIntoView({block:'center'}),50);}}/><label>工作区默认模型<select value={workspaceModelId??''} onChange={event=>{const current=workspaceMutation();void api.setWorkspaceModel(event.target.value||null).then(({workspace})=>{if(current())applyWorkspace(workspace);}).catch(()=>setSyncError('工作区模型保存失败，请重试。'));}}><option value="">继承全局默认模型</option>{providerCatalog.models.map(model=><option key={model.id} value={model.id}>{model.displayName}</option>)}</select></label><details><summary>已归档讨论</summary>{discussionNodes.filter(node=>node.status==='archived').map(node=><div key={node.id}>{node.title}<button onClick={()=>void restoreGraphNode(node.id)}>恢复讨论</button></div>)}</details><button onClick={() => runCommand(() => setView('chat'))}>当前讨论 <kbd>⌘1</kbd></button><button onClick={() => runCommand(() => setView('graph'))}>对话图谱 <kbd>⌘2</kbd></button><button onClick={() => runCommand(() => setView('state'))}>知识状态 <kbd>⌘3</kbd></button><button onClick={() => runCommand(() => setView('activity'))}>活动时间线 <kbd>⌘4</kbd></button><button onClick={() => runCommand(() => setContextOpen(true))}>打开 Context <kbd>⌘⇧C</kbd></button><button onClick={() => runCommand(() => { setView('chat'); setFocusComposerRequest(value => value + 1); })}>聚焦消息输入框 <kbd>/</kbd></button><button onClick={() => runCommand(() => setOnboardingOpen(true))}>帮助与快捷键</button></section></div>}
      {onboardingOpen && <div className="dialog-backdrop" role="presentation"><section ref={activeModalRef} className="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title"><h2 id="onboarding-title">欢迎来到 Rhiza</h2><p>用四个对象把研究和决策留在同一个工作区：</p><dl><div><dt>Project</dt><dd>一个完整的研究或决策空间。</dd></div><div><dt>Node</dt><dd>围绕一个问题持续展开的讨论。</dd></div><div><dt>Graph</dt><dd>展示讨论之间的衍生、引用和合并关系。</dd></div><div><dt>Context</dt><dd>明确控制本轮发送给模型的材料。</dd></div></dl><button className="primary-button" autoFocus onClick={closeOnboarding}>开始使用</button></section></div>}
    </>}
  />;
}
