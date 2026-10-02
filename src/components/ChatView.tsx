import { ConversationManager, type SegmentRange } from './ConversationManager';
import { api } from '../api';
import { CollaborationCard, CollaborationForm } from './CollaborationCard';
import { MessageProvenance } from './MessageProvenance';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, AtSign, BookmarkPlus, Brain, ChevronRight, Copy, Edit3, EyeOff, FilePlus2, FileText, GitCompareArrows, GitBranch, GitMerge, Image, Paperclip, RefreshCw, RotateCcw, Send, SlidersHorizontal, Sparkles, Square, TextSelect, Trash2, Wrench, X } from 'lucide-react';
import type { ChatRequestOptions, RuntimeStreamEvent } from '../api';
import { presentErrorText } from '../error-presentation';
import type { Anchor, Attachment, ContextManifest, ContextMode, CollaborationInput, CollaborationRecord, DiscussionEdge, DiscussionNode, GenerationOptions, Message, ProviderCatalog, ProviderStatus, TemporaryBranch, Segment, WorkspaceSnapshot } from '../types';
import { MarkdownContent } from './MarkdownContent';
import { ModelSelector } from './ModelSelector';
import { ParticleMark } from './ParticleMark';
import { QuickGraph } from './QuickGraph';

type TemporaryInput = { sourceNodeId: string; anchorText: string; message: string; history: Array<Pick<Message, 'kind' | 'text'>> };
type BranchInput = { title: string; anchorText?: string; anchorStart?: number; anchorEnd?: number; sourceMessageId?: string; messages?: Array<Pick<Message, 'kind' | 'text' | 'createdAt'>> };
type SelectionAction = { message: Message; text: string; start: number; end: number; x: number; y: number };

interface ChatViewProps {
  onContinue?: () => void;
  onInspectProvenance?: (messageId: string) => void;
  readOnly?: boolean;
  focusMessageId?: string;
  provenanceMessageId?: string;
  activeNode: DiscussionNode;
  nodes: DiscussionNode[];
  edges: DiscussionEdge[];
  mode: ContextMode;
  activeCount: number;
  messages: Message[];
  manifests: ContextManifest[];
  attachments: Attachment[];
  provider: ProviderStatus;
  providerCatalog: ProviderCatalog;
  syncError: string;
  online: boolean;
  focusComposerRequest: number;
  onSend: (text: string, options?: ChatRequestOptions) => Promise<void>;
  onUpload: (file: File) => Promise<Attachment>;
  onTempSend: (input: TemporaryInput, onEvent?: (event: RuntimeStreamEvent) => void, options?: ChatRequestOptions) => Promise<{ userMessage: Message; assistantMessage: Message; model: string }>;
  onCreateBranch: (input: BranchInput) => Promise<void>;
  onActivateNode: (id: string) => Promise<void>;
  onMerge: (id: string) => Promise<void>;
  onSelectModel: (id: string) => Promise<void>;
  onSettings: () => void;
  onOpenContext: () => void;
  onInspectContext?: (messageId: string) => void;
  onInspectManifest?: (manifestId: string) => void;
  onOpenRun?: (runId: string) => void;
  onDraftChange?: (query: string, attachmentIds: string[]) => void;
  collaborations?: CollaborationRecord[];
  collaborationBusy?: string;
  collaborationError?: string;
  collaborationStreams?: Record<string, { participantId: string; round: number; text: string }>;
  onStartCollaboration?: (input: CollaborationInput) => Promise<boolean>;
  onCollaborationAction?: (record: CollaborationRecord, operation: 'retry' | 'synthesize' | 'retain' | 'refresh', attemptId?: string) => void;
  onStopCollaboration?: (record: CollaborationRecord) => void;

  onGraph: () => void;
  onRuns?: () => void;
  segments?: Segment[];
  anchors?: Anchor[];
  onWorkspaceChanged?: (workspace: WorkspaceSnapshot) => void;
  onReconcile?: () => void;
  onRetry?: (runId:string,key:string,signal:AbortSignal) => Promise<void>;
}

function nodePath(node: DiscussionNode, nodes: DiscussionNode[]) {
  const byId = new Map(nodes.map(item => [item.id, item]));
  const path: DiscussionNode[] = [];
  const visited = new Set<string>();
  let cursor: DiscussionNode | undefined = node;
  while (cursor && !visited.has(cursor.id) && path.length < 50) {
    path.unshift(cursor); visited.add(cursor.id); cursor = cursor.sourceNodeId ? byId.get(cursor.sourceNodeId) : undefined;
  }
  return path;
}

function formatBytes(size: number) {
  return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function ManifestSummary({ manifest }: { manifest: ContextManifest }) {
  return <details className="manifest-summary">
    <summary><GitMerge size={14}/><span>Context Manifest · {manifest.id.slice(0, 8)}</span><small>{manifest.contextItems.length} sources · {manifest.estimatedTokens.toLocaleString()} tk</small></summary>
    <div className="manifest-body">
      <header><span>{manifest.mode} · {manifest.operation}</span><span>{manifest.provider} / {manifest.model}</span></header>
      {manifest.contextItems.map(item => <div className="manifest-source" key={`${item.sourceType}:${item.sourceId}`}>
        <span>{item.sourceType === 'node' ? <GitBranch size={13}/> : <FileText size={13}/>}</span>
        <div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.selectionMode.replaceAll('_', ' ')}{item.pinned ? ' · PINNED' : ''} · v{item.contentVersion} · {item.tokenCount.toLocaleString()} tk</small><em>{item.reason}</em></div>
      </div>)}
      {manifest.planner && <p className="manifest-excluded"><Sparkles size={12}/>Planner {manifest.planner.fallback ? '已降级' : `从 ${manifest.planner.candidateCount} 个候选中选择 ${manifest.planner.selectedCount} 项`} · {manifest.planner.elapsedMs.toFixed(1)} ms</p>}
      {manifest.excludedItemIds.length > 0 && <p className="manifest-excluded"><EyeOff size={12}/>本轮显式排除 {manifest.excludedItemIds.length} 项</p>}
      <footer>冻结于 {new Date(manifest.createdAt).toLocaleString()} · Request {manifest.requestId.slice(0, 8)}</footer>
    </div>
  </details>;
}

export function ChatView({ onContinue, onInspectProvenance, readOnly = false, focusMessageId, provenanceMessageId, activeNode, nodes, edges, mode, activeCount, messages, manifests, attachments, provider, providerCatalog, syncError, online, focusComposerRequest, onSend, onUpload, onTempSend, onCreateBranch, onActivateNode, onMerge, onSelectModel, onSettings, onOpenContext, onInspectContext, onInspectManifest, onOpenRun, onDraftChange, collaborations = [], collaborationBusy = '', collaborationError = '', collaborationStreams = {}, onStartCollaboration, onCollaborationAction, onStopCollaboration, onGraph, onRuns, segments = [], anchors = [], onWorkspaceChanged, onReconcile, onRetry }: ChatViewProps) {
  const [collaborationPrompt, setCollaborationPrompt] = useState<string>();
  const renderCollaboration = (record: CollaborationRecord) => <CollaborationCard key={record.id} record={record} busy={readOnly || !!onContinue || !!collaborationBusy} running={collaborationBusy.includes(record.id)} retained={messages.some(message => !!message.sourceMessageId && message.sourceMessageId === record.attempts.filter(attempt => attempt.participantId === '@synthesis' && attempt.status === 'completed').at(-1)?.outputRef)} streams={collaborationBusy.includes(record.id) ? collaborationStreams : {}} onAction={(operation, attemptId) => onCollaborationAction?.(record, operation, attemptId)} onStop={() => onStopCollaboration?.(record)} onInspectContext={onInspectManifest} onOpenRun={onOpenRun}/>;
  const [segmentRange,setSegmentRange]=useState<SegmentRange>();
  const tempAbortRef=useRef<AbortController|null>(null); const tempRunRef=useRef<string | undefined>(undefined);
  const attemptRef=useRef<{key:string;workspaceId?:string;nodeId:string;text:string;options:ChatRequestOptions} | undefined>(undefined); const tempAttemptRef=useRef<{key:string;workspaceId?:string} | undefined>(undefined);
  const liveRef=useRef(true);const resolvingRetryRef=useRef(false);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [chatError, setChatError] = useState('');
  const [lastAttempt, setLastAttempt] = useState<{ text: string; options: ChatRequestOptions } | null>(null);
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [generation, setGeneration] = useState<GenerationOptions>({ temperature: 0.4, topP: 1, maxTokens: 2048 });
  const [controlsOpen, setControlsOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(80);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [selectionAction, setSelectionAction] = useState<SelectionAction | null>(null);
  const [temporary, setTemporary] = useState<TemporaryBranch | null>(null);
  const [tempDraft, setTempDraft] = useState('');
  const [tempThinking, setTempThinking] = useState(false);
  const [tempError, setTempError] = useState('');
  const [preserving, setPreserving] = useState(false);
  const [quickGraphOpen, setQuickGraphOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const tempEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const runIdRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const path = useMemo(() => nodePath(activeNode, nodes), [activeNode, nodes]);
  const compactPath = path.length <= 3 ? path : [path[0], null, ...path.slice(-2)];
  const hasStreamingAnswer = messages.some(message => message.kind === 'assistant' && message.pending && (message.text || message.reasoning || message.toolCalls?.length));
  const targetIndex = focusMessageId ? messages.findIndex(message => message.id === focusMessageId) : -1;
  const visibleMessages = messages.slice(targetIndex >= 0 ? Math.min(targetIndex, Math.max(0, messages.length - visibleCount)) : -visibleCount);
  const attachmentById = useMemo(() => new Map(attachments.map(item => [item.id, item])), [attachments]);
  const manifestById = useMemo(() => new Map(manifests.map(item => [item.id, item])), [manifests]);

  useEffect(() => { setVisibleCount(80); }, [activeNode.id]);
  useEffect(() => { if (!focusMessageId && typeof endRef.current?.scrollIntoView === 'function') endRef.current.scrollIntoView({ behavior: 'smooth' }); }, [messages, thinking, focusMessageId]);
  useEffect(() => { if (typeof tempEndRef.current?.scrollIntoView === 'function') tempEndRef.current.scrollIntoView({ behavior: 'smooth' }); }, [temporary?.messages, tempThinking]);
  useEffect(() => {liveRef.current=true;return () => {liveRef.current=false; };}, []);
  useEffect(() => { composerRef.current?.focus(); }, [focusComposerRequest]);
  useEffect(() => { onDraftChange?.(draft, selectedAttachmentIds); }, [draft, selectedAttachmentIds, onDraftChange]);
  useEffect(() => {
    if (collaborationPrompt !== undefined) conversationRef.current?.querySelector<HTMLElement>('.collaboration-form')?.scrollIntoView?.({ block: 'start' });
  }, [collaborationPrompt]);
  useEffect(() => {
    if (!collaborationBusy.startsWith('run:')) return;
    setCollaborationPrompt(undefined);
    conversationRef.current?.ownerDocument.getElementById(`collaboration-${collaborationBusy.slice(4)}`)?.scrollIntoView?.({ block: 'start' });
  }, [collaborationBusy]);

  const execute = async (text: string, options: ChatRequestOptions, reuseKey?:string) => {
    if (readOnly || !text.trim() || abortRef.current || !online) return;
    const controller = new AbortController();
    abortRef.current = controller;
    runIdRef.current = undefined;
    const key=reuseKey??crypto.randomUUID();
    const frozen={...options,generation:{...(options.generation??generation)},attachmentIds:options.attachmentIds?[...options.attachmentIds]:undefined};
    attemptRef.current={key,workspaceId:api.workspaceId(),nodeId:activeNode.id,text,options:frozen};
    const requestOptions = { ...frozen, idempotencyKey:key, signal: controller.signal, onRunCreated: (runId: string) => { runIdRef.current = runId; } };
    if (options.operation === 'send' || options.operation === 'retry') setDraft('');
    setThinking(true); setChatError(''); setLastAttempt({ text, options:frozen });
    try {
      if(options.operation==='retry'&&options.parentRunRef&&onRetry)await onRetry(options.parentRunRef,key,controller.signal);else await onSend(text, requestOptions);
      if(liveRef.current){setDraft(''); setSelectedAttachmentIds([]); setLastAttempt(null);attemptRef.current=undefined;}
    } catch (error) {
      if(liveRef.current){setChatError(presentErrorText(error, { message: '无法完成本轮对话。', recovery: '请重试。' }));
      if (options.operation === 'send' || options.operation === 'retry') setDraft(text);}
    } finally {
      abortRef.current = null; if(liveRef.current)setThinking(false);
    }
  };

  const retry = async () => {
    const attempt=attemptRef.current;
    if(!lastAttempt||!attempt||resolvingRetryRef.current||abortRef.current||!online)return;
    if(attempt.nodeId!==activeNode.id){setChatError('请返回来源讨论后确认执行状态。');return;}
    resolvingRetryRef.current=true;
    try{
      const run=await api.findAttemptRun(attempt.key,attempt.workspaceId);
      if(!liveRef.current||attempt.workspaceId!==api.workspaceId()||attemptRef.current!==attempt)return;
      if(run?.status==='completed'){onReconcile?.();setLastAttempt(null);attemptRef.current=undefined;setChatError('');setDraft('');return;}
      if(run&&['created','dispatching','running'].includes(run.status)){setChatError('原执行仍在进行，请查看执行历史。');return;}
      if(run)await execute(attempt.text,{...attempt.options,operation:'retry',parentRunRef:run.id});
      else await execute(attempt.text,attempt.options,attempt.key);
    }catch(error){if(liveRef.current)setChatError(presentErrorText(error,{message:'执行状态待确认。',recovery:'请查看执行历史后重试。'}));}
    finally{resolvingRetryRef.current=false;}
  };
  const send = () => lastAttempt ? retry() : execute(draft.trim(), { operation:'send', attachmentIds: selectedAttachmentIds });
  const regenerate = (message: Message) => execute('重新生成上一轮回答', { operation: 'regenerate', sourceMessageId: message.id });
  const editAndResend = (message: Message) => {
    const text = editDraft.trim();
    if (!text) return;
    setEditingId(null); setEditDraft('');
    void execute(text, { operation: 'edit-resend', sourceMessageId: message.id, attachmentIds: message.attachmentIds });
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const policy = providerCatalog.filePolicy;
    const remaining = Math.max(0, (policy?.maxFiles || 10) - selectedAttachmentIds.length);
    setUploading(true); setChatError('');
    try {
      for (const file of [...files].slice(0, remaining)) {
        const attachment = await onUpload(file);
        setSelectedAttachmentIds(current => [...new Set([...current, attachment.id])]);
      }
    } catch (error) { setChatError(presentErrorText(error, { message: '无法上传附件。', recovery: '请检查文件后重试。' })); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const openTemporary = (message: Message, anchorText: string, anchorStart?: number, anchorEnd?: number) => {
    const normalized = anchorText.trim().slice(0, 4000);
    if (!normalized) return;
    setTemporary({ id: `temp-${Date.now()}`, sourceNodeId: activeNode.id, sourceMessageId: message.id, anchorText: normalized, anchorStart, anchorEnd, title: `探索：${normalized.replace(/\s+/g, ' ').slice(0, 22)}`, messages: [] });
    setSelectionAction(null); setTempDraft(''); setTempError(''); window.getSelection()?.removeAllRanges();
  };

  const captureSelection = (event: React.MouseEvent<HTMLElement>, message: Message) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.anchorNode || !event.currentTarget.contains(selection.anchorNode)) return;
    const text = selection.toString().trim();
    if (text.length < 2) return;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const start = message.text.indexOf(text);
    setSelectionAction({ message, text, start: Math.max(0, start), end: start >= 0 ? start + text.length : text.length, x: Math.min(rect.left + rect.width / 2, window.innerWidth - 90), y: Math.max(12, rect.top - 42) });
  };

  const sendTemp = async () => {
    if (!temporary || !tempDraft.trim() || tempThinking || !online) return;
    const text = tempDraft.trim(); const controller=new AbortController();tempAbortRef.current=controller;tempRunRef.current=undefined;const key=crypto.randomUUID();tempAttemptRef.current={key,workspaceId:api.workspaceId()}; const pendingId=`temp-pending-${key}`;
    setTempDraft(''); setTempThinking(true); setTempError('');
    try {
      const result = await onTempSend({ sourceNodeId: temporary.sourceNodeId, anchorText: temporary.anchorText, message: text, history: temporary.messages.filter(message=>!message.pending).map(({ kind, text: messageText }) => ({ kind, text: messageText })) },event=>{ if(event.type==='CONTENT_DELTA')setTemporary(current=>{if(!current||current.id!==temporary.id)return current;const pending=current.messages.find(message=>message.id===pendingId)??{id:pendingId,nodeId:`temp:${temporary.sourceNodeId}`,kind:'assistant' as const,text:'',createdAt:new Date().toISOString(),pending:true};return {...current,messages:[...current.messages.filter(message=>message.id!==pendingId),{...pending,text:pending.text+event.delta}]};}); },{ signal:controller.signal,idempotencyKey:key,onRunCreated:runId=>{tempRunRef.current=runId;} });
      setTemporary(current => current ? { ...current, messages: [...current.messages.filter(message=>message.id!==pendingId), result.userMessage, result.assistantMessage] } : current);
    } catch (error) { setTempDraft(text); setTempError(presentErrorText(error, { message: '无法完成临时对话。', recovery: '请重试。' })); } finally { tempAbortRef.current=null;setTemporary(current=>current?{...current,messages:current.messages.filter(message=>message.id!==pendingId)}:current);setTempThinking(false); }
  };

  const preserveTemporary = async () => {
    if (!temporary?.title.trim()) return;
    setPreserving(true); setTempError('');
    try {
      await onCreateBranch({ title: temporary.title.trim(), anchorText: temporary.anchorText, ...(temporary.anchorStart !== undefined && temporary.anchorEnd !== undefined ? { anchorStart: temporary.anchorStart, anchorEnd: temporary.anchorEnd } : {}), sourceMessageId: temporary.sourceMessageId, messages: temporary.messages.map(({ kind, text, createdAt }) => ({ kind, text, createdAt })) });
      setTemporary(null);
    } catch (error) { setTempError(presentErrorText(error, { message: '无法保留支线。', recovery: '请稍后重试。' })); } finally { setPreserving(false); }
  };

  const createFormalBranch = async (message: Message) => {
    setChatError('');
    const compact = message.text.replace(/\s+/g, ' ').trim();
    try {
      await onCreateBranch({ title: `支线：${compact.slice(0, 22)}`, anchorText: message.text, anchorStart: 0, anchorEnd: message.text.length, sourceMessageId: message.id });
    } catch (error) { setChatError(presentErrorText(error, { message: '无法创建正式支线。', recovery: '请稍后重试。' })); }
  };

  const renderAttachments = (ids: string[] = [], removable = false) => ids.length ? <div className="attachment-list">{ids.map(id => {
    const file = attachmentById.get(id);
    if (!file) return null;
    return <span className="attachment-chip" key={id}>{file.kind === 'image' ? <Image size={13}/> : <FileText size={13}/>}<span><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></span>{removable && <button aria-label={`移除附件 ${file.name}`} onClick={() => setSelectedAttachmentIds(current => current.filter(item => item !== id))}><X size={12}/></button>}</span>;
  })}</div> : null;

  return <main id="workspace-main" tabIndex={-1} className={`workspace chat-view ${temporary ? 'temp-branch-open' : ''}`}>
    <header className="workspace-header"><div><div className="crumbs node-breadcrumb">{compactPath.map((node, index) => node ? <span key={node.id}>{node.title}{index < compactPath.length - 1 && <ChevronRight size={12}/>}</span> : <span className="path-ellipsis" key="ellipsis">…<ChevronRight size={12}/></span>)}</div><span className="discussion-state"><span className={`node-state ${activeNode.status}`}><i/> {activeNode.status}</span></span></div><div className="header-actions">{onRuns && <button className="ghost-button" onClick={onRuns}>执行历史</button>}{activeNode.kind === 'branch' && activeNode.status !== 'resolved' && <button className="ghost-button merge-button" onClick={() => onMerge(activeNode.id)}><GitMerge size={15}/>合并回主线</button>}<button className="ghost-button" aria-expanded={quickGraphOpen} onClick={() => setQuickGraphOpen(open => !open)}><GitBranch size={15}/>快速图谱</button><button className="ghost-button" onClick={onGraph}><GitBranch size={15}/>完整图谱</button></div></header>
    {quickGraphOpen && <QuickGraph
      nodes={nodes}
      edges={edges}
      activeNodeId={activeNode.id}
      onActivate={async id => { await onActivateNode(id); setQuickGraphOpen(false); }}
      onOpenFull={onGraph}
      onClose={() => setQuickGraphOpen(false)}
    />}
    <div ref={conversationRef} className="conversation" onScroll={() => setSelectionAction(null)}>
      <details className="discussion-details"><summary>讨论信息与管理</summary><p>{activeNode.summary}</p>{activeNode.anchorText && <blockquote className="branch-anchor"><span>来源锚点</span>{activeNode.anchorText}</blockquote>}
    {onWorkspaceChanged&&<div inert={readOnly}><ConversationManager key={activeNode.id} node={activeNode} segments={segments} anchors={anchors} messages={messages} catalog={providerCatalog} range={segmentRange} onMerge={()=>void onMerge(activeNode.id)} onChanged={workspace=>{setSegmentRange(undefined);onWorkspaceChanged(workspace);}} onLocate={id=>{setVisibleCount(messages.length);requestAnimationFrame(()=>document.getElementById(`message-${id}`)?.scrollIntoView({block:'center'}));}}/></div>}</details>
      <div className="timeline">
        {messages.length === 0 && <div className="chat-empty"><Sparkles size={20}/><strong>从一个问题开始</strong><p>这个讨论节点还没有消息；输入问题即可建立第一轮上下文。</p></div>}
        {messages.length > visibleMessages.length && <button className="load-older" onClick={() => setVisibleCount(count => count + 80)}>加载更早消息 · 尚有 {messages.length - visibleMessages.length} 条</button>}
        {visibleMessages.map((message, index) => <Fragment key={message.id}>{message.kind === 'user' ? <article id={`message-${message.id}`} className={`message user-message ${message.pending ? 'pending' : ''}`} key={message.id}>
          <div className="message-meta"><span>YOU</span><time>第 {Math.floor((messages.length - visibleMessages.length + index) / 2) + 1} 轮</time>{message.version && message.version > 1 && <b>v{message.version} · {message.operation}</b>}</div>
          {editingId === message.id ? <div className="message-editor"><textarea aria-label="编辑消息" value={editDraft} onChange={event => setEditDraft(event.target.value)}/><div><button onClick={() => setEditingId(null)}>取消</button><button onClick={() => editAndResend(message)} disabled={!editDraft.trim()}>发送新版本</button></div></div> : <MarkdownContent content={message.text}/>} {renderAttachments(message.attachmentIds)}
          {!message.pending && <div className="message-actions">{onInspectContext && <button onClick={() => onInspectContext(message.id)}><FileText size={13}/>查看本轮上下文</button>}<button onClick={() => navigator.clipboard?.writeText(message.text)}><Copy size={13}/>复制</button><button disabled={readOnly} onClick={() => { setEditingId(message.id); setEditDraft(message.text); }}><Edit3 size={13}/>编辑并重发</button><button disabled={readOnly} onClick={() => void createFormalBranch(message)}><GitBranch size={13}/>创建正式支线</button></div>}
        </article> : <article id={`message-${message.id}`} className={`message assistant-message selectable-answer ${message.pending ? 'pending' : ''}`} key={message.id} onMouseUp={event => captureSelection(event, message)}>
          <div className="assistant-head"><ParticleMark compact/><span>RHIZA</span>{message.version && message.version > 1 && <b>v{message.version}</b>}<small>{message.pending ? '正在生成' : manifestById.get(message.manifestId || '')?.contextItems ? `使用 ${manifestById.get(message.manifestId || '')!.contextItems.length} 个冻结来源` : '历史来源未完整记录'}</small></div>
          {message.reasoning && <details className="reasoning-panel"><summary><Brain size={13}/>Reasoning / Progress</summary><p>{message.reasoning}</p></details>}
          {message.toolCalls?.map(tool => <details className="tool-call" key={tool.id}><summary><Wrench size={13}/>Tool · {tool.name || '调用中'}</summary><pre>{tool.arguments || '{}'}</pre></details>)}
          <div className="answer-paragraph"><MarkdownContent content={message.text || (message.toolCalls?.length ? '正在等待工具结果…' : '')}/>{message.text && <button className="paragraph-branch" aria-label="讨论整个段落" title="将整段放入临时支线" onClick={() => openTemporary(message, message.text)}><TextSelect size={14}/></button>}</div>
          {!message.pending && <div className="message-actions">{onInspectContext && <button onClick={() => onInspectContext(message.id)}><FileText size={13}/>查看本轮上下文</button>}<button onClick={() => navigator.clipboard?.writeText(message.text)}><Copy size={14}/>复制</button>{onStartCollaboration && <button disabled={readOnly || !online || !!collaborationBusy || thinking} onClick={() => setCollaborationPrompt(`请评审以下回答，指出风险、分歧与改进建议：\n\n${message.text}`)}><GitCompareArrows size={14}/>多模型协作</button>}<button disabled={readOnly} onClick={() => regenerate(message)}><RefreshCw size={14}/>重新生成</button><button disabled={readOnly} onClick={() => void createFormalBranch(message)}><GitBranch size={14}/>创建正式支线</button><button disabled={readOnly} onClick={() => openTemporary(message, message.text)}><GitBranch size={14}/>在临时支线中讨论</button></div>}
          {!message.pending && <MessageProvenance outputId={message.id} onOpen={onInspectProvenance ? () => onInspectProvenance(message.id) : undefined} forceOpen={message.id === provenanceMessageId} onInspectContext={onInspectManifest} onOpenRun={onOpenRun}/>}
          {message.usage && <div className="usage-line">{message.usage.estimated && '≈ '}Prompt {message.usage.promptTokens.toLocaleString()} · Completion {message.usage.completionTokens.toLocaleString()} · Total {message.usage.totalTokens.toLocaleString()} tokens</div>}
          {message.manifestId && manifestById.get(message.manifestId)?.contextItems ? <ManifestSummary manifest={manifestById.get(message.manifestId)!}/> : message.manifestId && <div className="branch-note"><span className="branch-line"/><GitMerge size={14}/><span>Context Manifest · {message.manifestId.slice(0, 8)}</span></div>}
        </article>}{collaborations.filter(record => record.base.history.at(-1)?.id === message.id).map(renderCollaboration)}</Fragment>)}
        {collaborations.filter(record => !messages.some(message => message.id === record.base.history.at(-1)?.id)).map(renderCollaboration)}
        {collaborationPrompt !== undefined && !collaborationBusy.startsWith('run:') && onStartCollaboration && <CollaborationForm key={collaborationPrompt} prompt={collaborationPrompt} catalog={providerCatalog} attachmentIds={selectedAttachmentIds} busy={readOnly || !!onContinue || !!collaborationBusy} onStart={onStartCollaboration} onClose={() => setCollaborationPrompt(undefined)} onSettings={onSettings}/>}
        {collaborationError && <p className="collaboration-error" role="alert">{collaborationError}</p>}
        {thinking && !hasStreamingAnswer && <div className="thinking"><ParticleMark compact/><span>正在组织上下文</span><i/><i/><i/></div>}
        <div ref={endRef}/>
      </div>
    </div>
    {selectionAction && <button className="selection-branch-action" style={{ left: selectionAction.x, top: selectionAction.y }} onMouseDown={event => event.preventDefault()} onClick={() => openTemporary(selectionAction.message, selectionAction.text, selectionAction.start, selectionAction.end)}><GitBranch size={13}/>讨论选中内容</button>}
    {selectionAction && onWorkspaceChanged && <button className="selection-segment-action" onClick={()=>{setSegmentRange({messageId:selectionAction.message.id,selectedText:selectionAction.text,startOffset:selectionAction.start,endOffset:selectionAction.end});setSelectionAction(null);}}>保存选中内容为 Segment</button>}
    {temporary && <aside className="temporary-branch" aria-label="临时支线"><header><div><span className="temp-status"><i/> TEMP · 未保存</span><input aria-label="临时支线标题" value={temporary.title} onChange={event => setTemporary(current => current ? { ...current, title: event.target.value } : current)}/></div><button aria-label="丢弃临时支线" onClick={() => { tempAbortRef.current?.abort(); setTemporary(null); }}><X size={16}/></button></header><blockquote><span>选中内容</span>{temporary.anchorText}</blockquote><div className="temp-thread">{temporary.messages.length === 0 && <div className="temp-empty"><GitBranch size={18}/><strong>这是临时探索空间</strong><p>对话只存在于当前页面；点击“保留”后才会进入节点树与对话图谱。</p></div>}{temporary.messages.map(message => <article className={`temp-message ${message.kind}`} key={message.id}><span>{message.kind === 'user' ? 'YOU' : 'RHIZA'}</span><MarkdownContent content={message.text}/></article>)}{tempThinking && <div className="thinking"><ParticleMark compact/><span>沿锚点继续思考</span><i/><i/><i/></div>}<div ref={tempEndRef}/>{tempThinking&&<button aria-label="停止临时生成" onClick={()=>{tempAbortRef.current?.abort();const attempt=tempAttemptRef.current;if(attempt)void api.cancelAttempt(attempt.key,tempRunRef.current,attempt.workspaceId).catch(()=>setTempError('停止状态待确认，请查看执行历史。'));}}>停止临时生成</button>}</div>{tempError && <div className="temp-error" role="alert">{tempError}</div>}<div className="temp-composer"><textarea aria-label="临时支线消息" rows={2} value={tempDraft} onChange={event => setTempDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendTemp(); } }} placeholder={online ? '围绕选中内容追问…' : '离线时不能发送消息'} disabled={!online}/><button aria-label="发送临时消息" onClick={() => void sendTemp()} disabled={!online || !tempDraft.trim() || tempThinking || !provider.configured}><Send size={15}/></button></div><footer><button className="discard-temp" onClick={() => { tempAbortRef.current?.abort(); setTemporary(null); }}><Trash2 size={14}/>丢弃</button><button className="keep-temp" onClick={() => void preserveTemporary()} disabled={!online || !temporary.title.trim() || preserving || tempThinking}><BookmarkPlus size={14}/>{preserving ? '保留中…' : '保留为讨论流'}</button></footer></aside>}
    {readOnly && <p className="read-only-notice" role="status">讨论或片段已归档，当前只读。历史证据仍可查看。</p>}
    {onContinue && <p className="read-only-notice">正在浏览此讨论；当前上下文与协作需要明确继续。<button onClick={onContinue}>继续此讨论</button></p>}
    <div className="composer-wrap" inert={readOnly}>
      {(chatError || syncError || !online) && <div className="composer-error" role="alert"><span>{!online ? '当前离线，恢复网络后即可继续发送。' : chatError || syncError}</span>{lastAttempt && online && <button onClick={() => void retry()}><RotateCcw size={13}/>重试</button>}</div>}
      {renderAttachments(selectedAttachmentIds, true)}
      {controlsOpen && <div className="generation-controls"><label>Temperature <input aria-label="Temperature" type="number" min="0" max="2" step="0.1" value={generation.temperature} onChange={event => setGeneration(current => ({ ...current, temperature: Number(event.target.value) }))}/></label><label>Top P <input aria-label="Top P" type="number" min="0.05" max="1" step="0.05" value={generation.topP} onChange={event => setGeneration(current => ({ ...current, topP: Number(event.target.value) }))}/></label><label>Max tokens <input aria-label="Max tokens" type="number" min="1" max="32768" step="128" value={generation.maxTokens} onChange={event => setGeneration(current => ({ ...current, maxTokens: Number(event.target.value) }))}/></label></div>}
      <div className="composer"><textarea ref={composerRef} aria-label="输入消息" value={draft} onChange={event => { setDraft(event.target.value); setLastAttempt(null);attemptRef.current=undefined; }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} placeholder={online ? '继续这段讨论…' : '离线时不能发送消息'} rows={2} disabled={readOnly || !online}/><div className="composer-tools"><div><input ref={fileInputRef} className="file-input" type="file" multiple accept={providerCatalog.filePolicy?.supportedMimeTypes.join(',')} onChange={event => void uploadFiles(event.target.files)}/><button aria-label="添加附件" onClick={() => fileInputRef.current?.click()} disabled={!online || uploading || providerCatalog.filePolicy?.disabled}><Paperclip size={16}/></button><button aria-label="引用节点" onClick={onOpenContext}><AtSign size={16}/></button><button aria-label="添加文件" onClick={() => fileInputRef.current?.click()} disabled={!online || uploading}><FilePlus2 size={16}/></button>{onStartCollaboration && <button aria-label="发起多模型协作" disabled={readOnly || !online || thinking || !!collaborationBusy} onClick={() => setCollaborationPrompt(draft || '请对当前讨论给出独立评审与第二意见')}><GitCompareArrows size={16}/></button>}<button className={controlsOpen ? 'active' : ''} aria-label="生成参数" onClick={() => setControlsOpen(open => !open)}><SlidersHorizontal size={16}/></button></div><div className="send-side"><ModelSelector catalog={providerCatalog} onSelect={onSelectModel} onSettings={onSettings}/><span className={provider.configured && online ? 'provider-online' : 'provider-offline'}><Sparkles size={13}/>{online ? (provider.configured ? 'Ready' : '未连接') : '离线'} · {mode} · {activeCount} sources</span>{thinking ? <button className="send-button stop-button" onClick={() => { abortRef.current?.abort(); const attempt=attemptRef.current; if(attempt)void api.cancelAttempt(attempt.key,runIdRef.current,attempt.workspaceId).then(()=>onReconcile?.()).catch(()=>setChatError('停止状态待确认，请查看执行历史。')); }} aria-label="停止生成"><Square size={13} fill="currentColor"/></button> : <button className="send-button" onClick={() => void send()} disabled={readOnly || !draft.trim() || !provider.configured || !online || uploading} aria-label="发送"><ArrowUp size={17}/></button>}</div></div></div>
      <p className="composer-caption"><span className="live-dot"/> 发送时固定来源版本；未确认的推荐不会加入本轮。</p>
    </div>
  </main>;
}
