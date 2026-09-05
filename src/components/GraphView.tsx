import { useEffect, useRef, useState } from 'react';
import { Archive, Check, Focus, Grip, Link2, Maximize2, Minus, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { presentErrorText } from '../error-presentation';
import type { GraphEdgeModel, GraphNodeModel, GraphRelation } from './graph-model';

const STAGE_WIDTH = 2200;
const STAGE_HEIGHT = 1400;
const NODE_WIDTH = 148;
const NODE_HEIGHT = 84;
const EDGE_LABELS: Record<GraphRelation, string> = { 'derived-from': '衍生支线', references: '引用', 'related-to': '相关', 'merged-into': '选择性合并' };

type Point = { x: number; y: number };
type Viewport = Point & { scale: number };
type DragState = { id: string; offsetX: number; offsetY: number; moved: boolean; x: number; y: number };
type PanState = { x: number; y: number; startX: number; startY: number };

interface GraphViewProps {
  loading?: boolean;
  error?: string;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onRefresh?: () => void;
  nodes: GraphNodeModel[];
  edges: GraphEdgeModel[];
  activeNodeId: string;
  onMove: (id: string, x: number, y: number) => Promise<void>;
  onActivate: (id: string) => Promise<void>;
  onCreateNode: (input: { title: string; summary?: string; x: number; y: number }) => Promise<void>;
  onArchiveNode: (id: string) => Promise<void>;
  onRestoreNode: (id: string) => Promise<void>;
  onCreateEdge: (input: { source: string; target: string; relation: GraphRelation; label: string }) => Promise<void>;
  onDeleteEdge: (id: string) => Promise<void>;
}

export function GraphView({ loading = false, error = '', hasMore = false, onLoadMore, onRefresh, nodes, edges, activeNodeId, onMove, onActivate, onCreateNode, onArchiveNode, onRestoreNode, onCreateEdge, onDeleteEdge }: GraphViewProps) {
  const canvasRef = useRef<HTMLElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<PanState | null>(null);
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [query, setQuery] = useState('');
  const [connectMode, setConnectMode] = useState(false);
  const [connectionSourceId, setConnectionSourceId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [nodeFormOpen, setNodeFormOpen] = useState(false);
  const [nodeForm, setNodeForm] = useState({ title: '', summary: '' });
  const [edgeForm, setEdgeForm] = useState<{ source: string; target: string; relation: GraphRelation; label: string } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<GraphNodeModel | null>(null);
  const [actionError, setActionError] = useState('');
  const activeNodes = nodes.filter(node => node.status !== 'archived');
  const archivedNodes = nodes.filter(node => node.status === 'archived');

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
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button,input,select,[data-no-pan="true"]')) return;
    panRef.current = { x: viewport.x, y: viewport.y, startX: event.clientX, startY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMoveCanvas = (event: React.PointerEvent<HTMLElement>) => {
    const pan = panRef.current;
    if (!pan) return;
    setViewport(current => ({ ...current, x: pan.x + event.clientX - pan.startX, y: pan.y + event.clientY - pan.startY }));
  };
  const pointerUpCanvas = (event: React.PointerEvent<HTMLElement>) => {
    panRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const pointerDownNode = (event: React.PointerEvent<HTMLElement>, node: GraphNodeModel) => {
    event.stopPropagation();
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
    const drag = dragRef.current;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag) return;
    if (drag.moved) {
      try { await onMove(node.id, drag.x, drag.y); } catch (error) { setPositions(current => { const next = { ...current }; delete next[node.id]; return next; }); setActionError(presentErrorText(error, { message: '无法保存节点位置。', recovery: '请稍后重试。' })); }
      return;
    }
    if (connectMode) {
      if (!connectionSourceId) setConnectionSourceId(node.id);
      else if (connectionSourceId !== node.id) {
        setEdgeForm({ source: connectionSourceId, target: node.id, relation: 'related-to', label: EDGE_LABELS['related-to'] });
        setConnectionSourceId(null);
      }
      return;
    }
    try { await onActivate(node.id); } catch (error) { setActionError(presentErrorText(error, { message: '无法打开节点。', recovery: '请刷新后重试。' })); }
  };
  const openNodeCreate = () => { setActionError(''); setNodeForm({ title: '', summary: '' }); setNodeFormOpen(true); };
  const submitNode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!nodeForm.title.trim()) return;
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
    if (!edgeForm?.label.trim()) return;
    try {
      await onCreateEdge({ ...edgeForm, label: edgeForm.label.trim() });
      setEdgeForm(null);
      setConnectMode(false);
    } catch (error) { setActionError(presentErrorText(error, { message: '无法创建关系。', recovery: '请稍后重试。' })); }
  };
  const archiveNode = async () => {
    if (!archiveTarget) return;
    try {
      await onArchiveNode(archiveTarget.id);
      setArchiveTarget(null);
    } catch (error) { setActionError(presentErrorText(error, { message: '无法归档节点。', recovery: '请稍后重试。' })); }
  };
  const restoreNode = async (id: string) => {
    try { await onRestoreNode(id); } catch (error) { setActionError(presentErrorText(error, { message: '无法恢复节点。', recovery: '请稍后重试。' })); }
  };
  const deleteEdge = async () => {
    if (!selectedEdgeId) return;
    try {
      await onDeleteEdge(selectedEdgeId);
      setSelectedEdgeId(null);
    } catch (error) { setActionError(presentErrorText(error, { message: '无法删除关系。', recovery: '请稍后重试。' })); }
  };

  const normalizedQuery = query.trim().toLowerCase();
  const filteredNodes = activeNodes.filter(node => !normalizedQuery || `${node.title}\n${node.summary}\n${node.anchorText || ''}`.toLowerCase().includes(normalizedQuery));
  const visibleIds = new Set(filteredNodes.map(node => node.id));
  const selectedEdge = edges.find(edge => edge.id === selectedEdgeId);
  return <main id="workspace-main" tabIndex={-1} className="workspace graph-view">
    <header className="workspace-header graph-header"><div><span className="eyebrow">CONVERSATION GRAPH</span><h1>对话图谱</h1><p>{activeNodes.length} 个可见讨论节点 · {edges.length} 条语义关系 · 滚轮缩放，空白处拖拽画布</p></div><div className="graph-status-key"><span><i className="legend-current"/>当前讨论</span><span><i className="legend-active"/>进行中</span><span><i className="legend-resolved"/>已合并</span></div></header>
    <div className="graph-loading-controls" aria-live="polite">
      <span>{loading ? '正在加载图谱…' : `已加载 ${nodes.length} 个节点`}</span>
      {hasMore && <button disabled={loading} onClick={onLoadMore}>加载更多</button>}
      {onRefresh && <button disabled={loading} onClick={onRefresh}>刷新图谱</button>}
      {error && <span role="alert">{error}</span>}
    </div>
    <section className="graph-canvas" aria-label="讨论关系图" ref={canvasRef} onWheel={handleWheel} onPointerDown={pointerDownCanvas} onPointerMove={pointerMoveCanvas} onPointerUp={pointerUpCanvas}>
      <div className="graph-search" data-no-pan="true"><Search size={15}/><input aria-label="搜索图谱" placeholder="搜索标题、摘要或来源锚点" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && filteredNodes[0]) focusNode(filteredNodes[0]); }} onPointerDown={event => event.stopPropagation()}/><span>{filteredNodes.length}</span></div>
      <div className="graph-toolbar" data-no-pan="true">
        <button aria-label="新建图谱节点" title="新建节点" onClick={openNodeCreate}><Plus size={14}/>节点</button>
        <button className={connectMode ? 'active' : ''} aria-label="创建图谱关系" title="依次点击两个节点创建关系" onClick={() => { setConnectMode(current => !current); setConnectionSourceId(null); }}><Link2 size={14}/>{connectMode ? '选择节点' : '关系'}</button>
        {selectedEdge && <button className="danger" aria-label="删除选中关系" title={`删除关系：${selectedEdge.label}`} onClick={deleteEdge}><Trash2 size={14}/>删除关系</button>}
      </div>
      <div className="graph-stage" style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT, transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}>
        <svg className="edges" width={STAGE_WIDTH} height={STAGE_HEIGHT} viewBox={`0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}`} aria-hidden="true">
          {edges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target)).map(edge => {
            const source = nodes.find(node => node.id === edge.source);
            const target = nodes.find(node => node.id === edge.target);
            if (!source || !target) return null;
            const from = positionOf(source); const to = positionOf(target);
            const sx = from.x + NODE_WIDTH; const sy = from.y + NODE_HEIGHT / 2; const tx = to.x; const ty = to.y + NODE_HEIGHT / 2; const mid = (sx + tx) / 2;
            const path = `M ${sx} ${sy} C ${mid} ${sy}, ${mid} ${ty}, ${tx} ${ty}`;
            return <g key={edge.id} className={`graph-edge ${edge.relation} ${edge.id === selectedEdgeId ? 'selected' : ''}`} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setSelectedEdgeId(edge.id); }}><path d={path}/><path className="graph-edge-hit" d={path}/><text x={mid} y={(sy + ty) / 2 - 7}>{edge.label}</text></g>;
          })}
        </svg>
        {filteredNodes.map(node => {
          const position = positionOf(node);
          const selectedForConnection = connectionSourceId === node.id;
          return <article className={`graph-node ${node.kind} ${node.status} ${node.id === activeNodeId ? 'current' : ''} ${selectedForConnection ? 'connection-source' : ''}`} style={{ left: position.x, top: position.y }} key={node.id} role="button" tabIndex={0} aria-label={`讨论节点：${node.title}`} onPointerDown={event => pointerDownNode(event, node)} onPointerMove={pointerMoveNode} onPointerUp={event => void pointerUpNode(event, node)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') void onActivate(node.id); }} title={connectMode ? '点击选择关系节点' : '拖拽移动，点击打开讨论'}>
            <span className="node-kicker">{node.kind === 'main' ? 'MAIN NODE' : 'DISCUSSION NODE'} <Grip size={12}/></span><strong>{node.title}</strong><small>{node.status === 'resolved' ? '已合并回主线' : node.summary}</small>
            <button className="node-delete" data-no-pan="true" aria-label={`归档节点 ${node.title}`} title="归档节点" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setArchiveTarget(node); }}><Archive size={12}/></button><i className="port left"/><i className="port right"/>
          </article>;
        })}
      </div>
      {!loading && filteredNodes.length === 0 && <div className="graph-empty">没有匹配的讨论节点</div>}
      <div className="graph-overview" data-no-pan="true" aria-label="图谱概览">{activeNodes.map(node => <i key={node.id} className={node.id === activeNodeId ? 'current' : ''} style={{ left: `${node.x / STAGE_WIDTH * 100}%`, top: `${node.y / STAGE_HEIGHT * 100}%` }}/>)}</div>
      <div className="graph-controls" data-no-pan="true"><button aria-label="缩小图谱" onClick={() => zoomAt(viewport.scale - .1)}><Minus size={16}/></button><span aria-label="当前缩放比例">{Math.round(viewport.scale * 100)}%</span><button aria-label="放大图谱" onClick={() => zoomAt(viewport.scale + .1)}><Plus size={16}/></button><button aria-label="重置画布" onClick={() => setViewport({ x: 0, y: 0, scale: 1 })}><RotateCcw size={15}/></button><button aria-label="适合全部节点" onClick={() => fitNodes(activeNodes)}><Maximize2 size={15}/></button><button aria-label="聚焦当前节点" onClick={() => { const node = activeNodes.find(item => item.id === activeNodeId); if (node) focusNode(node); }}><Focus size={16}/></button></div>
      <div className="graph-hint"><span>{connectMode ? 'CONNECT' : 'PAN / ZOOM'}</span> {connectMode ? (connectionSourceId ? '再点击一个节点完成关系' : '点击第一个节点作为关系起点') : '拖动空白处平移 · 滚轮缩放 · 点击关系后删除'}</div>
      {actionError && <div className="graph-error" role="alert"><span>{actionError}</span><button aria-label="关闭图谱错误" onClick={() => setActionError('')}><X size={13}/></button></div>}
    </section>

    <section className="graph-archive" aria-label="已归档节点">
      <header><Archive size={14}/><strong>已归档节点</strong><span>{archivedNodes.length}</span></header>
      {archivedNodes.length === 0 ? <p>暂无已归档节点。</p> : <ul>{archivedNodes.map(node => <li key={node.id}><span><strong>{node.title}</strong><small>{node.summary || '无摘要'}</small></span><button type="button" onClick={() => void restoreNode(node.id)}><RotateCcw size={13}/>恢复</button></li>)}</ul>}
    </section>

    {nodeFormOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setNodeFormOpen(false); }}><form className="graph-dialog" aria-label="新建图谱节点" onSubmit={submitNode}><div className="graph-dialog-head"><div><span className="eyebrow">NEW NODE</span><h2>新建讨论节点</h2></div><button type="button" className="icon-button" aria-label="关闭新建节点" onClick={() => setNodeFormOpen(false)}><X size={16}/></button></div><label><span>节点标题</span><input autoFocus value={nodeForm.title} onChange={event => setNodeForm(current => ({ ...current, title: event.target.value }))} placeholder="例如：验证检索分层" maxLength={120}/></label><label><span>摘要（可选）</span><textarea value={nodeForm.summary} onChange={event => setNodeForm(current => ({ ...current, summary: event.target.value }))} placeholder="说明这个节点要探索的问题" maxLength={500}/></label><div className="dialog-actions"><button type="button" className="ghost-button" onClick={() => setNodeFormOpen(false)}>取消</button><button type="submit" className="primary-button" disabled={!nodeForm.title.trim()}><Check size={14}/>创建节点</button></div></form></div>}
    {edgeForm && <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setEdgeForm(null); }}><form className="graph-dialog" aria-label="新建图谱关系" onSubmit={submitEdge}><div className="graph-dialog-head"><div><span className="eyebrow">NEW RELATION</span><h2>连接两个讨论节点</h2></div><button type="button" className="icon-button" aria-label="关闭新建关系" onClick={() => setEdgeForm(null)}><X size={16}/></button></div><p className="graph-dialog-note">{nodes.find(node => node.id === edgeForm.source)?.title} <span>→</span> {nodes.find(node => node.id === edgeForm.target)?.title}</p><label><span>关系类型</span><select value={edgeForm.relation} onChange={event => setEdgeForm(current => current ? { ...current, relation: event.target.value as GraphRelation, label: EDGE_LABELS[event.target.value as GraphRelation] } : current)}><option value="related-to">相关（RELATED_TO）</option><option value="references">引用（REFERENCES）</option><option value="derived-from">衍生支线</option><option value="merged-into">选择性合并</option></select></label><label><span>关系标签</span><input value={edgeForm.label} onChange={event => setEdgeForm(current => current ? { ...current, label: event.target.value } : current)} maxLength={120}/></label><div className="dialog-actions"><button type="button" className="ghost-button" onClick={() => setEdgeForm(null)}>取消</button><button type="submit" className="primary-button" disabled={!edgeForm.label.trim()}><Link2 size={14}/>创建关系</button></div></form></div>}
    {archiveTarget && <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setArchiveTarget(null); }}><div className="graph-dialog" role="alertdialog" aria-label="归档图谱节点"><div className="graph-dialog-head"><div><span className="eyebrow">ARCHIVE NODE</span><h2>归档讨论节点？</h2></div><button type="button" className="icon-button" aria-label="关闭归档节点" onClick={() => setArchiveTarget(null)}><X size={16}/></button></div><p className="graph-dialog-note">“{archiveTarget.title}” 将从日常导航和图谱中隐藏；消息和关系会保留，之后可在归档区恢复。</p><div className="dialog-actions"><button type="button" className="ghost-button" onClick={() => setArchiveTarget(null)}>取消</button><button type="button" className="primary-button" onClick={() => void archiveNode()}><Archive size={14}/>确认归档</button></div></div></div>}
  </main>;
}
