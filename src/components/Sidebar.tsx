import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Archive, ChevronDown, ChevronRight, ChevronsUp, CornerDownRight, FolderKanban, GitFork, ListTree, MessageSquareMore, Search, Settings2, Shapes } from 'lucide-react';
import type { DiscussionNode, Message, View, WorkspaceRecord } from '../types';
import { ParticleMark } from './ParticleMark';

function pathFor(nodeId: string, nodes: DiscussionNode[]) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const path: DiscussionNode[] = [];
  const visited = new Set<string>();
  let current = byId.get(nodeId);
  while (current && !visited.has(current.id) && path.length < 50) {
    path.unshift(current); visited.add(current.id); current = current.sourceNodeId ? byId.get(current.sourceNodeId) : undefined;
  }
  return path;
}

export function Sidebar({ view, nodes, messages, activeNodeId, onView, onNode, onSettings, onCommand, onHelp, workspaces = [], currentWorkspaceId, onWorkspace }: { view: View; nodes: DiscussionNode[]; messages: Message[]; activeNodeId: string; onView: (view: View) => void; onNode: (id: string) => void; onSettings: () => void; onCommand: () => void; onHelp: () => void; workspaces?: WorkspaceRecord[]; currentWorkspaceId?: string; onWorkspace?: (id: string) => void }) {
  const activePath = useMemo(() => pathFor(activeNodeId, nodes), [activeNodeId, nodes]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focusPath, setFocusPath] = useState(false);
  const childrenByParent = useMemo(() => {
    const map = new Map<string, DiscussionNode[]>();
    for (const node of nodes) {
      const key = node.sourceNodeId || '__root__';
      map.set(key, [...(map.get(key) || []), node]);
    }
    for (const children of map.values()) children.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return map;
  }, [nodes]);

  useEffect(() => {
    setExpanded(current => {
      const next = new Set(current);
      for (const node of activePath) next.add(node.id);
      const ids = new Set(nodes.map(node => node.id));
      for (const root of nodes.filter(node => !node.sourceNodeId || !ids.has(node.sourceNodeId))) next.add(root.id);
      return next;
    });
  }, [activePath, nodes]);

  const visibleWhenFocused = useMemo(() => {
    const ids = new Set(activePath.map(node => node.id));
    for (const child of childrenByParent.get(activeNodeId) || []) ids.add(child.id);
    return ids;
  }, [activePath, activeNodeId, childrenByParent]);

  const renderNode = (node: DiscussionNode, depth: number): React.ReactNode => {
    if (focusPath && !visibleWhenFocused.has(node.id)) return null;
    const children = childrenByParent.get(node.id) || [];
    const isExpanded = expanded.has(node.id);
    const rounds = messages.filter(message => message.nodeId === node.id && message.kind === 'user').length;
    const cappedDepth = Math.min(depth, 3);
    return <div className="thread-tree-item" key={node.id}>
      <div className={`thread-tree-row ${node.id === activeNodeId ? 'active' : ''}`} style={{ '--tree-depth': cappedDepth } as CSSProperties}>
        {children.length > 0 ? <button className="tree-toggle" aria-label={`${isExpanded ? '折叠' : '展开'} ${node.title}`} onClick={() => setExpanded(current => { const next = new Set(current); if (isExpanded) next.delete(node.id); else next.add(node.id); return next; })}>{isExpanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}</button> : <span className="tree-leaf"><CornerDownRight size={11}/></span>}
        <button className="thread tree-thread" onClick={() => onNode(node.id)}><span className={`thread-dot ${node.status}`}/><span><strong>{node.title}</strong><small>{node.kind === 'branch' ? `L${depth + 1} 支线` : '主线'} · {rounds} 轮{node.status === 'resolved' ? ' · 已合并' : ''}</small></span></button>
        {depth > 3 && <span className="depth-badge" title={`当前位于第 ${depth + 1} 层`}>L{depth + 1}</span>}
      </div>
      {children.length > 0 && isExpanded && <div className="thread-children">{children.map(child => renderNode(child, depth + 1))}</div>}
    </div>;
  };

  const nodeIds = new Set(nodes.map(node => node.id));
  const roots = nodes.filter(node => !node.sourceNodeId || !nodeIds.has(node.sourceNodeId));
  const compactPath = activePath.length <= 3 ? activePath : [activePath[0], null, ...activePath.slice(-2)];
  return <aside className="sidebar">
    <div className="brand"><ParticleMark compact/><span><strong>根系</strong><small>Rhiza</small></span><button className="icon-button quiet" aria-label="模型与 API 设置" onClick={onSettings}><Settings2 size={15}/></button></div>
    <div className="project-switch"><span className="project-avatar">根</span><span><strong>{workspaces.find(item => item.workspaceId === currentWorkspaceId)?.name || 'Rhiza 产品研究'}</strong><small>Context-native workspace</small></span><ChevronDown size={15}/>{workspaces.length > 1 && <select aria-label="切换工作区" value={currentWorkspaceId} onChange={event => onWorkspace?.(event.target.value)}>{workspaces.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.name}</option>)}</select>}</div>
    <button className="search-button" onClick={onCommand}><Search size={15}/><span>搜索或运行命令</span><kbd>⌘ K</kbd></button>
    <div className="side-section"><div className="section-label"><span>工作空间</span></div><button className={view === 'chat' ? 'nav-item active' : 'nav-item'} onClick={() => onView('chat')}><span className="nav-glyph"><MessageSquareMore size={15}/></span>当前讨论<span className="count">{nodes.length}</span></button><button className={view === 'graph' ? 'nav-item active' : 'nav-item'} onClick={() => onView('graph')}><span className="nav-glyph"><GitFork size={15}/></span>对话图谱</button><button className={view === 'state' ? 'nav-item active' : 'nav-item'} onClick={() => onView('state')}><span className="nav-glyph"><Shapes size={15}/></span>知识状态<span className="status-dot warning"/></button></div>
    <div className="side-section threads hierarchical-threads">
      <div className="section-label"><span>讨论节点</span><button aria-label={focusPath ? '显示全部节点' : '聚焦当前路径'} onClick={() => setFocusPath(value => !value)}>{focusPath ? <ListTree size={14}/> : <ChevronsUp size={14}/>}</button></div>
      <div className="active-path-card"><span>当前位置 · L{activePath.length}</span><div>{compactPath.map((node, index) => node ? <button key={node.id} onClick={() => onNode(node.id)}>{node.title}{index < compactPath.length - 1 && <ChevronRight size={10}/>}</button> : <i key="ellipsis">…</i>)}</div>{activePath.length > 3 && <small>缩进已压缩，使用路径导航避免深层迷失</small>}</div>
      <div className="thread-tree">{roots.map(root => renderNode(root, 0))}</div>
    </div>
    <div className="sidebar-footer"><button className="nav-item"><Archive size={15}/>归档</button><button className="nav-item"><FolderKanban size={15}/>所有项目</button><button className="nav-item" onClick={onHelp}>帮助与快捷键</button></div>
  </aside>;
}
