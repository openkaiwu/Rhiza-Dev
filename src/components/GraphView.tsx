import { GRAPH_NODE_WIDTH as NODE_WIDTH, GRAPH_NODE_HEIGHT as NODE_HEIGHT, visibleGraphNodes } from './graph-viewport';
import { useEffect, useEffectEvent, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Archive, Check, Focus, Grip, Link2, Maximize2, Minus, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { presentErrorText } from '../error-presentation';
import { PurgeNodeControl } from './PurgeNodeControl';
import { DisclosureMenu } from './DisclosureMenu';
import type { GraphEdgeModel, GraphNodeModel, GraphPersonalPresentation, GraphRelation } from './graph-model';
import type { GraphBatchResult } from '../types';
import type { GraphDisplayFilters } from '../navigation';

const STAGE_WIDTH = 2200;
const STAGE_HEIGHT = 1400;
const EDGE_LABELS: Record<GraphRelation, string> = { 'derived-from': '衍生支线', references: '引用', 'related-to': '相关', 'merged-into': '选择性合并' };

type Point = { x: number; y: number };
type Viewport = Point & { scale: number };
type DragState = { id: string; offsetX: number; offsetY: number; moved: boolean; x: number; y: number };
type PanState = { x: number; y: number; startX: number; startY: number };

export interface GraphNavigationPresentation extends GraphPersonalPresentation { focusedObjectId?: string; query: string; statusFilter: string; since: string; pathTarget: string; pathIds: string[]; selectedEdgeId: string | null; listOpen: boolean; selection: string[]; batchMode: boolean }
interface GraphViewProps {
  contextBusy?: boolean;
  onContextSelectionChange?: () => void;
  displayFilters?: GraphDisplayFilters;
  onShareFilters?: (filters: GraphDisplayFilters) => Promise<boolean>;
  contextTray?: ReactNode;
  onPreviewContext?: (nodes: GraphNodeModel[]) => void | Promise<void>;
  readOnly?: boolean;
  initialPresentation?: GraphNavigationPresentation;
  onPresentationChange?: (presentation: GraphNavigationPresentation) => void;
  focusedObjectId?: string;
  onInspectObject?: (node: GraphNodeModel) => void;
  personalView?: GraphPersonalPresentation;
  personalLoading?: boolean;
  onSavePersonal?: (presentation: GraphPersonalPresentation) => Promise<void>;
  onReloadPersonal?: () => void;
  batch?: GraphBatchResult;
  batchBusy?: boolean;
  batchError?: string;
  onBatch?: (ids: string[], operation: 'archive' | 'relate', relation?: GraphRelation) => Promise<void>;
  onResumeBatch?: () => void;
  onReadBatch?: () => void;
  onUndoBatch?: () => void;
  loading?: boolean;
  error?: string;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onFilter?: (filters:{query?:string;statuses?:string[];updatedAfter?:string;objectTypes?:('conversation'|'segment'|'message')[]}) => void;
  onNeighborhood?: (id:string) => void;
  onNavigateObject?: (node:GraphNodeModel) => Promise<void>;
  onContext?: (node:GraphNodeModel,remove:boolean) => Promise<void>;
  contextIds?: string[];
  onPath?: (from:string,to:string) => Promise<string[]>;
  onRefresh?: () => void;
  nodes: GraphNodeModel[];
  edges: GraphEdgeModel[];
  activeNodeId: string;
  onMove: (id: string, x: number, y: number) => Promise<void>;
  onActivate: (id: string) => Promise<void>;
  onCreateNode: (input: { title: string; summary?: string; x: number; y: number }) => Promise<void>;
  onArchiveNode: (id: string) => Promise<void>;
  onRestoreNode: (id: string) => Promise<void>;
  onPurgeNode?: (id: string, confirmation: string, reason: string) => Promise<void>;
  onCreateEdge: (input: { source: string; target: string; relation: GraphRelation; label: string }) => Promise<void>;
  onDeleteEdge: (id: string) => Promise<void>;
}

export function GraphView({ contextBusy = false, onContextSelectionChange, displayFilters, onShareFilters, contextTray, onPreviewContext, readOnly = false, initialPresentation, onPresentationChange, focusedObjectId, onInspectObject, loading = false, error = '', hasMore = false, onLoadMore, onRefresh, nodes, edges, activeNodeId, onMove, onActivate, onCreateNode, onArchiveNode, onRestoreNode, onPurgeNode, onCreateEdge, onDeleteEdge, onNeighborhood, onNavigateObject, onContext, contextIds = [], onPath, onFilter, personalView, personalLoading = false, onSavePersonal, onReloadPersonal, batch, batchBusy = false, batchError, onBatch, onResumeBatch, onReadBatch, onUndoBatch }: GraphViewProps) {
  const canvasRef = useRef<HTMLElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<PanState | null>(null);
  const [positions, setPositions] = useState<Record<string, Point>>(initialPresentation?.positions ?? {});
  const [viewport, setViewport] = useState<Viewport>(initialPresentation?.viewport ?? { x: 0, y: 0, scale: .8 });
  const [layers,setLayers] = useState<GraphDisplayFilters['layers']>(displayFilters?.layers ?? initialPresentation?.layers);
  const [extraRelations,setExtraRelations] = useState<GraphDisplayFilters['relationTypes']>();
  const [extraStatuses,setExtraStatuses] = useState<string[]>();
  const filterSignature = JSON.stringify(displayFilters);
  const [listOpen,setListOpen]=useState(initialPresentation?.listOpen ?? false);
  const [size,setSize]=useState({width:800,height:600});
  const [statusFilter,setStatusFilter]=useState(initialPresentation?.statusFilter ?? '');const [relationFilter,setRelationFilter]=useState<string>(initialPresentation?.relationFilter ?? '');const [since,setSince]=useState(initialPresentation?.since ?? '');const [pathTarget,setPathTarget]=useState(initialPresentation?.pathTarget ?? '');const [pathIds,setPathIds]=useState<string[]>(initialPresentation?.pathIds ?? []);
  const [query, setQuery] = useState(initialPresentation?.query ?? '');
  const [connectMode, setConnectMode] = useState(false);
  const [connectionSourceId, setConnectionSourceId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(initialPresentation?.selectedEdgeId ?? null);
  const [nodeFormOpen, setNodeFormOpen] = useState(false);
  const [nodeForm, setNodeForm] = useState({ title: '', summary: '' });
  const [edgeForm, setEdgeForm] = useState<{ source: string; target: string; relation: GraphRelation; label: string } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<GraphNodeModel | null>(null);
  const [actionError, setActionError] = useState('');
  const [selection, setSelection] = useState<string[]>(initialPresentation?.selection ?? []);
  const draggedSources = useRef<GraphNodeModel[] | undefined>(undefined);
  const [batchMode, setBatchMode] = useState(initialPresentation?.batchMode ?? false);
  const [batchConfirmation, setBatchConfirmation] = useState(false);
  const [batchRelation, setBatchRelation] = useState<GraphRelation>('related-to');
  const [collapsedIds, setCollapsedIds] = useState<string[]>(initialPresentation?.collapsedIds ?? []);
  const [savingView, setSavingView] = useState(false);
  const [viewNotice, setViewNotice] = useState('');
  const applyDisplayFilters = useEffectEvent(() => {
    if (!displayFilters) return;
    const shared = Object.keys(displayFilters).length > 0;
    setLayers(shared ? displayFilters.layers : initialPresentation?.layers); setQuery(shared ? displayFilters.query ?? '' : initialPresentation?.query ?? '');
    setStatusFilter(shared ? displayFilters.statuses?.length === 1 ? displayFilters.statuses[0] : '' : initialPresentation?.statusFilter ?? ''); setExtraStatuses(displayFilters.statuses?.length && displayFilters.statuses.length > 1 ? displayFilters.statuses : undefined);
    setRelationFilter(shared ? displayFilters.relationTypes?.length === 1 ? displayFilters.relationTypes[0] : '' : initialPresentation?.relationFilter ?? ''); setExtraRelations(shared ? displayFilters.relationTypes?.length && displayFilters.relationTypes.length > 1 ? displayFilters.relationTypes : undefined : initialPresentation?.relationTypes); setSince(shared ? displayFilters.updatedAfter ?? '' : initialPresentation?.since ?? '');
  });
  useEffect(() => { applyDisplayFilters(); },[filterSignature]);
  const initializedPersonal = useRef(!!initialPresentation);
  const marqueeRef = useRef<{ start: Point; end: Point } | null>(null);
  const [marquee, setMarquee] = useState<{ start: Point; end: Point } | null>(null);
  useEffect(() => { onPresentationChange?.({ focusedObjectId, positions, viewport, collapsedIds, layers, relationTypes:extraRelations, relationFilter: relationFilter as GraphPersonalPresentation['relationFilter'], query, statusFilter, since, pathTarget, pathIds, selectedEdgeId, listOpen, selection, batchMode }); }, [positions, viewport, collapsedIds, layers, extraRelations, relationFilter, query, statusFilter, since, pathTarget, pathIds, selectedEdgeId, listOpen, selection, batchMode, onPresentationChange, focusedObjectId]);
  const restorePresentation = (presentation: GraphPersonalPresentation) => { setPositions(presentation.positions); if (presentation.viewport) setViewport(presentation.viewport); setCollapsedIds(presentation.collapsedIds); setLayers(presentation.layers); setExtraRelations(presentation.relationTypes); setRelationFilter(presentation.relationFilter); };
  useEffect(() => {
    if (!personalView || initializedPersonal.current) return;
    initializedPersonal.current = true;
    setPositions(personalView.positions); if (personalView.viewport) setViewport(personalView.viewport); setCollapsedIds(personalView.collapsedIds); if (!displayFilters?.relationTypes) { setRelationFilter(personalView.relationFilter);setExtraRelations(personalView.relationTypes); } if (!displayFilters?.layers) setLayers(personalView.layers);
  }, [personalView,displayFilters]);
  const toggleSelection = (id: string) => { if(contextBusy) return; onContextSelectionChange?.(); setBatchConfirmation(false); setSelection(previous => previous.includes(id) ? previous.filter(item => item !== id) : previous.length < 100 ? [...previous, id] : previous); };
  const selectableSource = (node: GraphNodeModel) => node.lifecycle !== 'tombstoned' && node.status !== 'archived' && (!node.objectType || node.objectType === 'conversation' || Boolean(onPreviewContext && node.objectType === 'segment'));
  const selectedSources = selection.flatMap(id => { const node = nodes.find(item=>item.id===id); return node && selectableSource(node) ? [node] : []; });
  const canReviewSelection = !readOnly && !batchBusy && !contextBusy && selection.length > 0 && selectedSources.length === selection.length;
  const reviewSelection = (sources = selectedSources) => { if (canReviewSelection && sources.length === selection.length && sources.every(source=>selection.includes(source.id))) void onPreviewContext?.(sources); };
  const savePresentation = async () => {
    if (readOnly || !onSavePersonal || savingView) return;
    setSavingView(true); setViewNotice('');
    try { await onSavePersonal({ positions: Object.fromEntries(nodes.filter(node => node.lifecycle !== 'tombstoned').map(node => [node.id, positionOf(node)])), viewport, collapsedIds, layers, relationTypes:extraRelations, relationFilter: relationFilter as GraphRelation | '' }); setViewNotice('个人视图已保存。'); }
    catch (error) { setViewNotice(presentErrorText(error, { message: '个人视图未保存。', recovery: '请重新读取已保存视图，再重试。' })); }
    finally { setSavingView(false); }
  };
  const activeNodes = nodes.filter(node => node.status !== 'archived');
  const archivedNodes = nodes.filter(node => node.status === 'archived'&&node.objectType!=='message');

  useEffect(()=>{const element=canvasRef.current;if(!element)return;const measure=()=>{const rect=element.getBoundingClientRect();if(rect.width>0&&rect.height>0)setSize({width:rect.width,height:rect.height});};measure();const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(measure):undefined;observer?.observe(element);window.addEventListener('resize',measure);return()=>{observer?.disconnect();window.removeEventListener('resize',measure);};},[]);
  const expanded=viewport.scale>.85 || Boolean(layers?.some(layer=>layer!=='conversation'));
  useEffect(()=>{if(expanded)onNeighborhood?.(activeNodeId);},[activeNodeId,expanded,onNeighborhood]);
  useEffect(()=>{const timer=setTimeout(()=>onFilter?.({query:query.trim()||undefined,statuses:extraStatuses ?? (statusFilter?[statusFilter]:undefined),updatedAfter:since?new Date(since).toISOString():undefined,objectTypes:layers}),200);return()=>clearTimeout(timer);},[query,statusFilter,extraStatuses,since,layers,onFilter]);
  const positionOf = (node: GraphNodeModel) => positions[node.id] || { x: node.x, y: node.y };
  const toWorldPoint = (clientX: number, clientY: number): Point | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: (clientX - rect.left - viewport.x) / viewport.scale, y: (clientY - rect.top - viewport.y) / viewport.scale };
  };
  const focusNode = (node: GraphNodeModel) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const position = positionOf(node);
    setViewport(current => ({ ...current, x: Math.round(rect.width / 2 - (position.x + NODE_WIDTH / 2) * current.scale), y: Math.round(rect.height / 2 - (position.y + NODE_HEIGHT / 2) * current.scale) }));
  };
  const fitNodes = (items = activeNodes) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !items.length) return;
    const points = items.map(positionOf);
    const minX = Math.min(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxX = Math.max(...points.map(point => point.x + NODE_WIDTH));
    const maxY = Math.max(...points.map(point => point.y + NODE_HEIGHT));
    const padding = 72;
    const scale = Math.max(.55, Math.min(1.4, Math.min((rect.width - padding * 2) / Math.max(NODE_WIDTH, maxX - minX), (rect.height - padding * 2) / Math.max(NODE_HEIGHT, maxY - minY))));
    setViewport({ scale, x: Math.round((rect.width - (maxX - minX) * scale) / 2 - minX * scale), y: Math.round((rect.height - (maxY - minY) * scale) / 2 - minY * scale) });
  };
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (initializedPersonal.current) return;
      const active = nodes.find(node => node.id === activeNodeId);
      if (active) focusNode(active);
    });
    return () => cancelAnimationFrame(frame);
    // Focus only when navigation changes; graph edits should not pull the viewport away.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNodeId]);
  const zoomAt = (nextScale: number, clientX?: number, clientY?: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const scale = Math.max(.55, Math.min(1.8, nextScale));
    setViewport(current => {
      if (clientX === undefined || clientY === undefined) return { ...current, scale };
      const world = { x: (clientX - rect.left - current.x) / current.scale, y: (clientY - rect.top - current.y) / current.scale };
      return { scale, x: clientX - rect.left - world.x * scale, y: clientY - rect.top - world.y * scale };
    });
  };
  const handleWheel = (event: React.WheelEvent<HTMLElement>) => {
    event.preventDefault();
    zoomAt(viewport.scale * (event.deltaY < 0 ? 1.08 : .92), event.clientX, event.clientY);
  };
  const pointerDownCanvas = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || contextBusy) return;
    const target = event.target as HTMLElement;
    if (target.closest('button,input,select,[data-no-pan="true"]')) return;
    if (batchMode || event.shiftKey) { const point = toWorldPoint(event.clientX, event.clientY); if (point) { marqueeRef.current = { start: point, end: point }; setMarquee(marqueeRef.current); setBatchMode(true); setListOpen(true); } }
    else panRef.current = { x: viewport.x, y: viewport.y, startX: event.clientX, startY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMoveCanvas = (event: React.PointerEvent<HTMLElement>) => {
    if (marqueeRef.current) { const point = toWorldPoint(event.clientX, event.clientY); if (point) { marqueeRef.current = { ...marqueeRef.current, end: point }; setMarquee(marqueeRef.current); } return; }
    const pan = panRef.current;
    if (!pan) return;
    setViewport(current => ({ ...current, x: pan.x + event.clientX - pan.startX, y: pan.y + event.clientY - pan.startY }));
  };
  const pointerUpCanvas = (event: React.PointerEvent<HTMLElement>) => {
    const box = marqueeRef.current;
    if (box) { const left = Math.min(box.start.x, box.end.x), top = Math.min(box.start.y, box.end.y), right = Math.max(box.start.x, box.end.x), bottom = Math.max(box.start.y, box.end.y); const ids = filteredNodes.filter(node => (isConversation(node) || (onPreviewContext && node.objectType === 'segment')) && node.lifecycle !== 'tombstoned' && positionOf(node).x < right && positionOf(node).x + NODE_WIDTH > left && positionOf(node).y < bottom && positionOf(node).y + NODE_HEIGHT > top).map(node => node.id); if (right-left > 2 || bottom-top > 2) { onContextSelectionChange?.(); setSelection(previous => [...new Set([...(event.shiftKey ? previous : []), ...ids])].slice(0,100)); } marqueeRef.current = null; setMarquee(null); }
    panRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const pointerDownNode = (event: React.PointerEvent<HTMLElement>, node: GraphNodeModel) => {
    event.stopPropagation();
    if (node.lifecycle==='tombstoned'||(node.objectType&&node.objectType!=='conversation')||readOnly||batchMode||event.shiftKey||event.metaKey||event.ctrlKey||personalLoading) return;
    const position = positionOf(node);
    const point = toWorldPoint(event.clientX, event.clientY);
    if (!point) return;
    dragRef.current = { id: node.id, offsetX: point.x - position.x, offsetY: point.y - position.y, moved: false, ...position };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMoveNode = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const point = toWorldPoint(event.clientX, event.clientY);
    if (!drag || !point) return;
    const x = Math.max(18, Math.min(STAGE_WIDTH - NODE_WIDTH - 18, point.x - drag.offsetX));
    const y = Math.max(18, Math.min(STAGE_HEIGHT - NODE_HEIGHT - 18, point.y - drag.offsetY));
    drag.moved = drag.moved || Math.abs(event.movementX) + Math.abs(event.movementY) > 2;
    drag.x = Math.round(x); drag.y = Math.round(y);
    setPositions(current => ({ ...current, [drag.id]: { x: drag.x, y: drag.y } }));
  };
  const pointerUpNode = async (event: React.PointerEvent<HTMLElement>, node: GraphNodeModel) => {
    event.stopPropagation();
    if ((event.target as Element).closest('button,input,select,[data-no-pan="true"]')) return;
    const drag = dragRef.current;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag) { if ((batchMode || event.shiftKey || event.metaKey || event.ctrlKey) && selectableSource(node)) { setBatchMode(true); setListOpen(true); toggleSelection(node.id); } else if(onInspectObject && node.lifecycle !== 'tombstoned') onInspectObject(node); else if(node.lifecycle!=='tombstoned'&&node.objectType&&node.objectType!=='conversation')await onNavigateObject?.(node);return; }
    if (drag.moved) {
      try { await onMove(node.id, drag.x, drag.y); } catch (error) { setPositions(current => { const next = { ...current }; delete next[node.id]; return next; }); setActionError(presentErrorText(error, { message: '无法保存节点位置。', recovery: '请稍后重试。' })); }
      return;
    }
    if (node.lifecycle==='tombstoned') return;
    if (connectMode && !readOnly) {
      if (!connectionSourceId) setConnectionSourceId(node.id);
      else if (connectionSourceId !== node.id) {
        setEdgeForm({ source: connectionSourceId, target: node.id, relation: 'related-to', label: EDGE_LABELS['related-to'] });
        setConnectionSourceId(null);
      }
      return;
    }
    try { if (onInspectObject) onInspectObject(node); else await (node.objectType&&node.objectType!=='conversation'?onNavigateObject?.(node):onActivate(node.id)); } catch (error) { setActionError(presentErrorText(error, { message: '无法打开节点。', recovery: '请刷新后重试。' })); }
  };
  const openNodeCreate = () => { if (readOnly) return; setActionError(''); setNodeForm({ title: '', summary: '' }); setNodeFormOpen(true); };
  const submitNode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (readOnly || !nodeForm.title.trim()) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const center = { x: (rect.width / 2 - viewport.x) / viewport.scale - NODE_WIDTH / 2, y: (rect.height / 2 - viewport.y) / viewport.scale - NODE_HEIGHT / 2 };
    try {
      await onCreateNode({ title: nodeForm.title.trim(), summary: nodeForm.summary.trim(), x: Math.max(18, Math.round(center.x)), y: Math.max(18, Math.round(center.y)) });
      setNodeFormOpen(false);
    } catch (error) { setActionError(presentErrorText(error, { message: '无法创建节点。', recovery: '请稍后重试。' })); }
  };
  const submitEdge = async (event: React.FormEvent) => {
    event.preventDefault();
    if (readOnly || !edgeForm?.label.trim()) return;
    try {
      await onCreateEdge({ ...edgeForm, label: edgeForm.label.trim() });
      setEdgeForm(null);
      setConnectMode(false);
    } catch (error) { setActionError(presentErrorText(error, { message: '无法创建关系。', recovery: '请稍后重试。' })); }
  };
  const archiveNode = async () => {
    if (readOnly || !archiveTarget) return;
    try {
      await onArchiveNode(archiveTarget.id);
      setArchiveTarget(null);
    } catch (error) { setActionError(presentErrorText(error, { message: '无法归档节点。', recovery: '请稍后重试。' })); }
  };
  const restoreNode = async (id: string) => {
    if (readOnly) return;
    try { await onRestoreNode(id); } catch (error) { setActionError(presentErrorText(error, { message: '无法恢复节点。', recovery: '请稍后重试。' })); }
  };
  const deleteEdge = async () => {
    if (readOnly || !selectedEdgeId) return;
    try {
      await onDeleteEdge(selectedEdgeId);
      setSelectedEdgeId(null);
    } catch (error) { setActionError(presentErrorText(error, { message: '无法删除关系。', recovery: '请稍后重试。' })); }
  };

  const normalizedQuery = query.trim().toLowerCase();
  const isConversation=(node:GraphNodeModel)=>!node.objectType||node.objectType==='conversation';
  const nearParentIds=new Set([activeNodeId,...nodes.filter(node=>node.objectType==='segment'&&node.parentId===activeNodeId).map(node=>node.id)]);
  const focusedAncestry = new Set<string>();
  let focusedAncestor = nodes.find(node => node.id === focusedObjectId);
  for (let depth = 0; focusedAncestor && depth < 3; depth++) { if (focusedAncestry.has(focusedAncestor.id)) break; focusedAncestry.add(focusedAncestor.id); focusedAncestor = nodes.find(node => node.id === focusedAncestor?.parentId); }
  const filteredNodes=activeNodes.filter(node=>focusedAncestry.has(node.id)||(layers ? layers.includes(node.objectType ?? 'conversation') : (isConversation(node)||(viewport.scale>.85&&nearParentIds.has(node.parentId??'')&&!collapsedIds.includes(node.parentId??''))))&&(extraStatuses ? extraStatuses.includes(node.status) : (!statusFilter||node.status===statusFilter))&&(!since||!node.updatedAt||node.updatedAt>=since)&&(!normalizedQuery||`${node.title}\n${node.summary}\n${node.anchorText??''}`.toLowerCase().includes(normalizedQuery)));
  const visibleNodes=visibleGraphNodes(filteredNodes.map(node=>({...node,...positionOf(node)})),viewport,size);
  const canvasIds=new Set(visibleNodes.map(node=>node.id));
  const focusedObjectLoaded = nodes.some(node => node.id === focusedObjectId);
  const focusTarget = useEffectEvent(() => { if (initialPresentation?.focusedObjectId === focusedObjectId && focusedObjectId) return; const selected = nodes.find(node => node.id === focusedObjectId); if (selected) { if (selected.objectType && selected.objectType !== 'conversation') setViewport(current => ({...current,scale:Math.max(.9,current.scale)})); focusNode(selected); } });
  useEffect(() => { if (focusedObjectLoaded) { const frame = requestAnimationFrame(() => focusTarget()); return () => cancelAnimationFrame(frame); } }, [focusedObjectId, focusedObjectLoaded]);
  const selectedObject = nodes.find(node => node.id === focusedObjectId);
  const selectedEdge = edges.find(edge => edge.id === selectedEdgeId);
  return <main id="workspace-main" tabIndex={-1} className="workspace graph-view" style={{ '--graph-node-width': `${NODE_WIDTH}px`, '--graph-node-height': `${NODE_HEIGHT}px` } as CSSProperties}>
    <header className="workspace-header graph-header"><div><span className="eyebrow">CONVERSATION GRAPH</span><h1>对话图谱</h1><p>{activeNodes.length} 个可见讨论节点 · {edges.length} 条语义关系 · 滚轮缩放，空白处拖拽画布</p></div><div className="graph-status-key"><span><i className="legend-current"/>当前讨论</span><span><i className="legend-active"/>进行中</span><span><i className="legend-resolved"/>已合并</span></div></header>
    {readOnly && <p role="status">此工作区已归档，仅可浏览；恢复工作区后可修改图谱。</p>}
    <div className="graph-commandbar"><div className="graph-loading-controls" aria-live="polite">
      <span>{loading ? '正在加载图谱…' : `已加载 ${nodes.length} 个节点`}</span>
      {hasMore && <button disabled={loading} onClick={onLoadMore}>加载更多</button>}
      {onRefresh && <button disabled={loading} onClick={onRefresh}>刷新图谱</button>}
      {error && <span role="alert">{error}</span>}
    </div>
    <div className="graph-workbench-actions">{onBatch && <button disabled={contextBusy} aria-pressed={batchMode} onClick={() => { onContextSelectionChange?.(); setBatchMode(value => !value); setListOpen(true); setSelection([]); setBatchConfirmation(false); }}>{batchMode ? '结束选择' : '批量选择'}</button>}{onSavePersonal && <button disabled={readOnly || savingView || personalLoading || !personalView} onClick={() => void savePresentation()}>{savingView ? '保存中…' : '保存个人视图'}</button>}{(personalView || onReloadPersonal) && <DisclosureMenu label="图谱视图操作">{personalView && <button disabled={savingView || personalLoading} onClick={() => { restorePresentation(personalView); setViewNotice('已恢复保存的布局与缩放。'); }}>恢复已保存视图</button>}{onReloadPersonal && <button disabled={savingView || personalLoading} onClick={() => { initializedPersonal.current = false; onReloadPersonal(); }}>重新读取个人视图</button>}</DisclosureMenu>}{viewNotice && <span role="status">{viewNotice}</span>}</div>
    </div>
    <div className="graph-layer-controls" aria-label="显示层级"><span>显示层级</span><button aria-pressed={!layers} onClick={() => setLayers(undefined)}>随缩放</button>{([['conversation','讨论'],['segment','片段'],['message','消息']] as const).map(([layer,label]) => <label key={layer}><input type="checkbox" aria-label={`显示${label}层`} checked={Boolean(layers?.includes(layer))} onChange={event => setLayers(previous => { const next = event.target.checked ? [...(previous ?? []),layer] : (previous ?? []).filter(item=>item!==layer); return next.length ? next : undefined; })}/>{label}</label>)}{onShareFilters && <button onClick={() => { const filters:GraphDisplayFilters = { ...(layers ? {layers} : {}), ...(query.trim() ? {query:query.trim()} : {}), ...(extraStatuses || statusFilter ? {statuses:extraStatuses ?? [statusFilter]} : {}), ...(extraRelations || relationFilter ? {relationTypes:extraRelations ?? [relationFilter as GraphRelation]} : {}), ...(since ? {updatedAfter:since} : {}) }; void onShareFilters(filters).then(copied=>setViewNotice(copied ? '过滤链接已复制。' : '地址已更新，可复制地址栏分享。')).catch(()=>setActionError('无法生成过滤链接，请检查筛选条件。')); }}>分享当前过滤</button>}</div>
    <div className="graph-layer-controls" aria-label="关系图层"><span>关系图层</span>{Object.entries(EDGE_LABELS).map(([type,label]) => { const selected = extraRelations ?? (relationFilter ? [relationFilter as GraphRelation] : Object.keys(EDGE_LABELS) as GraphRelation[]); return <label key={type}><input type="checkbox" aria-label={`显示${label}关系`} checked={selected.includes(type as GraphRelation)} disabled={selected.length===1 && selected.includes(type as GraphRelation)} onChange={event => { const next = event.target.checked ? [...selected,type as GraphRelation] : selected.filter(item=>item!==type); setRelationFilter('');setExtraRelations(next.length===4 ? undefined : next); }}/>{label}</label>; })}<small>仅过滤显示，至少保留一种关系。</small></div>
    <details className="graph-tools"><summary>筛选与路径</summary><div className="graph-filters"><label>状态<select value={extraStatuses ? '__multiple__' : statusFilter} onChange={event=>{setExtraStatuses(undefined);setStatusFilter(event.target.value);}}><option value="">全部状态</option>{extraStatuses && <option value="__multiple__">所选 {extraStatuses.length} 种状态</option>}{['draft','active','resolved','stale'].map(status=><option key={status}>{status}</option>)}</select></label><label>关系<select value={extraRelations ? '__multiple__' : relationFilter} onChange={event=>{setExtraRelations(undefined);setRelationFilter(event.target.value);}}><option value="">全部关系</option>{extraRelations && <option value="__multiple__">所选 {extraRelations.length} 种关系</option>}{Object.entries(EDGE_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>更新时间之后<input type="date" value={since} onChange={event=>setSince(event.target.value)}/></label><label>路径目标<select value={pathTarget} onChange={event=>setPathTarget(event.target.value)}><option value="">选择讨论</option>{activeNodes.filter(node=>!node.objectType||node.objectType==='conversation').map(node=><option key={node.id} value={node.id}>{node.title}</option>)}</select></label><button disabled={!pathTarget||!onPath} onClick={()=>void onPath?.(activeNodeId,pathTarget).then(setPathIds).catch(()=>setActionError('路径查询失败，请刷新后重试。'))}>高亮路径</button><button onClick={()=>setPathIds([])}>清除路径</button><span>缩放 ≤85%：讨论 · 放大：Segment 与消息</span></div></details>
    {onPreviewContext && batchMode && <section className="graph-context-tray" aria-label="Context 来源托盘" onDragOver={event => { if (draggedSources.current && canReviewSelection) event.preventDefault(); }} onDrop={event => { event.preventDefault(); const sources = draggedSources.current; draggedSources.current = undefined; if(sources) reviewSelection(sources); }}>
      <div className="graph-tray-actions"><button disabled={!canReviewSelection} onClick={() => reviewSelection()}>审阅所选来源</button><button disabled={!canReviewSelection} draggable={canReviewSelection} onDragStart={event => { if(!canReviewSelection) { event.preventDefault(); return; } draggedSources.current = selectedSources; event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('text/plain','RHIZA Context selection'); }} onDragEnd={() => { draggedSources.current = undefined; }}>拖动所选来源 · {selection.length}</button></div>
      {contextTray}
    </section>}
    {batchMode && <section className="graph-batch-controls" aria-label="批量图谱操作"><span>已选 {selection.length} / 100 个来源 · {selection.map(id => nodes.find(node => node.id === id)?.title ?? id).join('、')}</span><label className="data-check"><input type="checkbox" checked={batchConfirmation} onChange={event => setBatchConfirmation(event.target.checked)}/>确认归档所选讨论（可撤销，消息与关系保留）</label><div><button disabled={readOnly || batchBusy || !selection.length || !batchConfirmation || selectedSources.some(node=>!isConversation(node))} onClick={() => void onBatch?.(selection, 'archive')}>归档所选讨论</button><select aria-label="批量关系类型" value={batchRelation} onChange={event => setBatchRelation(event.target.value as GraphRelation)}>{Object.entries(EDGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button disabled={readOnly || batchBusy || selection.length < 2 || selectedSources.some(node=>!isConversation(node))} onClick={() => void onBatch?.(selection, 'relate', batchRelation)}>连接所选讨论</button><small>从第一个所选讨论连接到其余讨论</small></div></section>}
    {(batch || batchError) && <section className="graph-batch-result" aria-label="批量操作结果">{batchError && <p role="alert">{batchError}</p>}{batch && <><strong>{batch.status === 'completed' ? '批量操作完成' : '批量操作部分完成，请检查每项结果'}</strong><details><summary>每项结果 · {batch.outcomes.length}</summary><ul>{batch.outcomes.map(item => {
      const codes = [...new Set([item.code, ...(item.steps ?? []).filter(step => step.status === 'failed' || step.status === 'blocked').map(step => step.code)]
        .filter((code): code is string => typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(code)))];
      return <li key={item.itemId}>{nodes.find(node => node.id === item.itemId)?.title ?? item.itemId} · {{ succeeded: '已完成', partial: '部分完成', failed: '失败', pending: '待完成', skipped: '已跳过' }[item.status]}{codes.length ? ` · ${codes.join(' · ')}` : item.status === 'failed' || item.status === 'partial' ? ' · 请读取批次结果后检查未完成项。' : ''}</li>;
    })}</ul></details></>}<div>{onReadBatch && batch && <button disabled={batchBusy} onClick={onReadBatch}>读取批次结果</button>}{onResumeBatch && (!batch || batch.status !== 'completed') && <button disabled={readOnly || batchBusy} onClick={onResumeBatch}>继续原批次</button>}{onUndoBatch && batch?.outcomes.some(item => item.undoable) && <button disabled={readOnly || batchBusy} onClick={onUndoBatch}>撤销已完成项</button>}</div></section>}
    {selectedObject && <section className="graph-object-inspector" aria-label="图谱对象"><strong>{selectedObject.title}</strong><span>{selectedObject.objectType ?? 'conversation'}{selectedObject.status === 'archived' ? ' · 已归档' : ''}</span><button disabled={selectedObject.lifecycle === 'tombstoned'} onClick={() => void (isConversation(selectedObject) ? onActivate(selectedObject.id) : onNavigateObject?.(selectedObject))}>打开讨论 / 来源</button></section>}
    <section className="graph-canvas" aria-label="讨论关系图" ref={canvasRef} onWheel={handleWheel} onPointerDown={pointerDownCanvas} onPointerMove={pointerMoveCanvas} onPointerUp={pointerUpCanvas}>
      {marquee && <div className="graph-marquee" aria-hidden="true" style={{ left: Math.min(marquee.start.x, marquee.end.x) * viewport.scale + viewport.x, top: Math.min(marquee.start.y, marquee.end.y) * viewport.scale + viewport.y, width: Math.abs(marquee.start.x - marquee.end.x) * viewport.scale, height: Math.abs(marquee.start.y - marquee.end.y) * viewport.scale }}/> }
      <div className="graph-search" data-no-pan="true"><Search size={15}/><input aria-label="搜索图谱" placeholder="搜索标题、摘要或来源锚点" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && filteredNodes[0]) focusNode(filteredNodes[0]); }} onPointerDown={event => event.stopPropagation()}/><span>{filteredNodes.length}</span></div>
      <div className="graph-toolbar" data-no-pan="true">
        <button disabled={readOnly} aria-label="新建图谱节点" title="新建节点" onClick={openNodeCreate}><Plus size={14}/>节点</button>
        <button className={connectMode ? 'active' : ''} disabled={readOnly} aria-label="创建图谱关系" title="依次点击两个节点创建关系" onClick={() => { setConnectMode(current => !current); setConnectionSourceId(null); }}><Link2 size={14}/>{connectMode ? '选择节点' : '关系'}</button>
        {selectedEdge && <button className="danger" disabled={readOnly} aria-label="删除选中关系" title={`删除关系：${selectedEdge.label}`} onClick={deleteEdge}><Trash2 size={14}/>删除关系</button>}
      </div>
      <div className="graph-stage" style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT, transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}>
        <svg className="edges" width={STAGE_WIDTH} height={STAGE_HEIGHT} viewBox={`0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}`} aria-hidden="true">
          {edges.filter(edge => canvasIds.has(edge.source)&&canvasIds.has(edge.target)&&(extraRelations ? extraRelations.includes(edge.relation) : (!relationFilter||edge.relation===relationFilter))).map(edge => {
            const source = nodes.find(node => node.id === edge.source);
            const target = nodes.find(node => node.id === edge.target);
            if (!source || !target) return null;
            const from = positionOf(source); const to = positionOf(target);
            const sx = from.x + NODE_WIDTH; const sy = from.y + NODE_HEIGHT / 2; const tx = to.x; const ty = to.y + NODE_HEIGHT / 2; const mid = (sx + tx) / 2;
            const path = `M ${sx} ${sy} C ${mid} ${sy}, ${mid} ${ty}, ${tx} ${ty}`;
            return <g key={edge.id} className={`graph-edge ${edge.relation} ${edge.id === selectedEdgeId ? 'selected' : ''}`} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setSelectedEdgeId(edge.id); }}><path d={path}/><path className="graph-edge-hit" d={path}/><text x={mid} y={(sy + ty) / 2 - 7}>{edge.label}</text></g>;
          })}
        </svg>
        {visibleNodes.map(node => {
          const position = positionOf(node);
          const selectedForConnection = connectionSourceId === node.id;
          return <article className={`graph-node ${node.kind} ${node.status} ${node.id === activeNodeId ? 'current' : ''} ${selectedForConnection ? 'connection-source' : ''} ${pathIds.includes(node.id)?'path-highlight':''} ${node.lifecycle==='tombstoned'?'tombstoned':''} ${selection.includes(node.id) || node.id === focusedObjectId ? 'batch-selected' : ''} ${node.objectType??'conversation'}`} style={{ left: position.x, top: position.y }} key={node.id} role="button" tabIndex={0} aria-label={`讨论节点：${node.title}`} onPointerDown={event => pointerDownNode(event, node)} onPointerMove={pointerMoveNode} onPointerUp={event => void pointerUpNode(event, node)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); void (node.lifecycle==='tombstoned'?undefined:batchMode&&selectableSource(node)?toggleSelection(node.id):node.objectType&&node.objectType!=='conversation'?onNavigateObject?.(node):onActivate(node.id)); } }} title={connectMode ? '点击选择关系节点' : '拖拽移动，点击打开讨论'}>
            <span className="node-kicker">{node.kind === 'main' ? 'MAIN NODE' : 'DISCUSSION NODE'} <Grip size={12}/></span><strong>{node.title}</strong><small>{node.status === 'resolved' ? '已合并回主线' : node.summary}</small>
            <button className="node-delete" data-no-pan="true" aria-label={`归档节点 ${node.title}`} title="归档节点" onPointerDown={event => event.stopPropagation()} disabled={readOnly || node.lifecycle==='tombstoned'||(node.objectType!==undefined&&node.objectType!=='conversation')} onClick={event => { event.stopPropagation(); setArchiveTarget(node); }}><Archive size={12}/></button><i className="port left"/><i className="port right"/>
          </article>;
        })}
      </div>
      {!loading && filteredNodes.length === 0 && <div className="graph-empty">没有匹配的讨论节点</div>}
      {!visibleNodes.length&&<p className="graph-empty" role="status">当前视口没有匹配节点，可搜索或适合全部节点。</p>}
      <div className="graph-overview" data-no-pan="true" aria-label="图谱概览">{activeNodes.map(node => <i key={node.id} className={node.id === activeNodeId ? 'current' : ''} style={{ left: `${node.x / STAGE_WIDTH * 100}%`, top: `${node.y / STAGE_HEIGHT * 100}%` }}/>)}</div>
      <div className="graph-controls" data-no-pan="true"><button aria-label="缩小图谱" onClick={() => zoomAt(viewport.scale - .1)}><Minus size={16}/></button><span aria-label="当前缩放比例">{Math.round(viewport.scale * 100)}%</span><button aria-label="放大图谱" onClick={() => zoomAt(viewport.scale + .1)}><Plus size={16}/></button><button aria-label="重置画布" onClick={() => setViewport({ x: 0, y: 0, scale: .8 })}><RotateCcw size={15}/></button><button aria-label="适合全部节点" onClick={() => fitNodes(activeNodes)}><Maximize2 size={15}/></button><button aria-label="聚焦当前节点" onClick={() => { const node = activeNodes.find(item => item.id === activeNodeId); if (node) focusNode(node); }}><Focus size={16}/></button></div>
      <div className="graph-hint"><span>{connectMode ? 'CONNECT' : 'PAN / ZOOM'}</span> {connectMode ? (connectionSourceId ? '再点击一个节点完成关系' : '点击第一个节点作为关系起点') : '空白平移 · 滚轮缩放 · Shift 框选 / 多选'}</div>
      {actionError && <div className="graph-error" role="alert"><span>{actionError}</span><button aria-label="关闭图谱错误" onClick={() => setActionError('')}><X size={13}/></button></div>}
    </section>

    <details className="graph-archive" role="region" aria-label="已归档节点">
      <summary><Archive size={14}/><strong>已归档节点</strong><span>{archivedNodes.length}</span></summary>
      {archivedNodes.length === 0 ? <p>暂无已归档节点。</p> : <ul>{archivedNodes.map(node => <li key={node.id}><span><strong>{node.title}</strong><small>{node.summary || '无摘要'}</small></span><button type="button" disabled={readOnly} onClick={() => void restoreNode(node.id)}><RotateCcw size={13}/>恢复</button>{onPurgeNode && <PurgeNodeControl nodeId={node.id} title={node.title} onPurge={onPurgeNode} disabled={readOnly}/>}</li>)}</ul>}
    </details>

    <details className="graph-accessible-list" open={listOpen} onToggle={event=>setListOpen(event.currentTarget.open)}><summary>图谱节点列表（键盘导航）</summary><ul>{listOpen&&filteredNodes.map(node=><li key={node.id}>{batchMode && selectableSource(node) && <input type="checkbox" aria-label={`${isConversation(node) ? '选择讨论' : '选择片段'} ${node.title}`} checked={selection.includes(node.id)} disabled={contextBusy || batchBusy || (!selection.includes(node.id) && selection.length >= 100)} onChange={() => toggleSelection(node.id)}/>}<button onClick={()=>focusNode(node)}>{node.title}</button>{node.lifecycle==='tombstoned'?<span>已清除 · 来源不可用</span>:<><button onClick={()=>void (isConversation(node)?onActivate(node.id):onNavigateObject?.(node))}>打开</button>{onContext&&node.objectType!=='message'&&<button disabled={readOnly} onClick={()=>{if(!readOnly)void onContext(node,contextIds.includes(node.id));}}>{contextIds.includes(node.id)?'移出 Context':'加入 Context'}</button>}{isConversation(node) && onSavePersonal && <button onClick={() => setCollapsedIds(previous => previous.includes(node.id) ? previous.filter(id => id !== node.id) : [...previous, node.id])}>{collapsedIds.includes(node.id) ? '展开层级' : '折叠层级'}</button>}</>}</li>)}</ul></details>
    {nodeFormOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setNodeFormOpen(false); }}><form className="graph-dialog" aria-label="新建图谱节点" onSubmit={submitNode}><div className="graph-dialog-head"><div><span className="eyebrow">NEW NODE</span><h2>新建讨论节点</h2></div><button type="button" className="icon-button" aria-label="关闭新建节点" onClick={() => setNodeFormOpen(false)}><X size={16}/></button></div><label><span>节点标题</span><input autoFocus value={nodeForm.title} onChange={event => setNodeForm(current => ({ ...current, title: event.target.value }))} placeholder="例如：验证检索分层" maxLength={120}/></label><label><span>摘要（可选）</span><textarea value={nodeForm.summary} onChange={event => setNodeForm(current => ({ ...current, summary: event.target.value }))} placeholder="说明这个节点要探索的问题" maxLength={500}/></label><div className="dialog-actions"><button type="button" className="ghost-button" onClick={() => setNodeFormOpen(false)}>取消</button><button type="submit" className="primary-button" disabled={readOnly || !nodeForm.title.trim()}><Check size={14}/>创建节点</button></div></form></div>}
    {edgeForm && <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setEdgeForm(null); }}><form className="graph-dialog" aria-label="新建图谱关系" onSubmit={submitEdge}><div className="graph-dialog-head"><div><span className="eyebrow">NEW RELATION</span><h2>连接两个讨论节点</h2></div><button type="button" className="icon-button" aria-label="关闭新建关系" onClick={() => setEdgeForm(null)}><X size={16}/></button></div><p className="graph-dialog-note">{nodes.find(node => node.id === edgeForm.source)?.title} <span>→</span> {nodes.find(node => node.id === edgeForm.target)?.title}</p><label><span>关系类型</span><select value={edgeForm.relation} onChange={event => setEdgeForm(current => current ? { ...current, relation: event.target.value as GraphRelation, label: EDGE_LABELS[event.target.value as GraphRelation] } : current)}><option value="related-to">相关（RELATED_TO）</option><option value="references">引用（REFERENCES）</option><option value="derived-from">衍生支线</option><option value="merged-into">选择性合并</option></select></label><label><span>关系标签</span><input value={edgeForm.label} onChange={event => setEdgeForm(current => current ? { ...current, label: event.target.value } : current)} maxLength={120}/></label><div className="dialog-actions"><button type="button" className="ghost-button" onClick={() => setEdgeForm(null)}>取消</button><button type="submit" className="primary-button" disabled={readOnly || !edgeForm.label.trim()}><Link2 size={14}/>创建关系</button></div></form></div>}
    {archiveTarget && <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setArchiveTarget(null); }}><div className="graph-dialog" role="alertdialog" aria-label="归档图谱节点"><div className="graph-dialog-head"><div><span className="eyebrow">ARCHIVE NODE</span><h2>归档讨论节点？</h2></div><button type="button" className="icon-button" aria-label="关闭归档节点" onClick={() => setArchiveTarget(null)}><X size={16}/></button></div><p className="graph-dialog-note">“{archiveTarget.title}” 将从日常导航和图谱中隐藏；消息和关系会保留，之后可在归档区恢复。</p><div className="dialog-actions"><button type="button" className="ghost-button" onClick={() => setArchiveTarget(null)}>取消</button><button type="button" className="primary-button" disabled={readOnly} onClick={() => void archiveNode()}><Archive size={14}/>确认归档</button></div></div></div>}
  </main>;
}
