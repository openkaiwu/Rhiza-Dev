import { useEffect, useRef, useState, type ReactNode } from 'react';
import { History, Menu, PanelLeftClose, PanelLeftOpen, PanelRight, ChevronDown } from 'lucide-react';
import { DisclosureMenu } from './DisclosureMenu';
import type { View } from '../types';

interface AppShellProps {
  view: View;
  hasDiscussionNodes: boolean;
  contextOpen: boolean;
  networkNotice: string;
  sidebar: ReactNode;
  surfaces: Record<View, ReactNode>;
  emptySurface: ReactNode;
  contextSurface: ReactNode;
  overlayLayer?: ReactNode;
  onCloseContext: () => void;
  title?: string;
  workspaceName?: string;
  contextCount?: number;
  onOpenContext?: () => void;
  onView?: (view: View) => void;
  navigationSurface?: ReactNode;
  primarySurface?: ReactNode;
}

export function AppShell({
  view,
  hasDiscussionNodes,
  contextOpen,
  networkNotice,
  sidebar,
  surfaces,
  emptySurface,
  contextSurface,
  overlayLayer,
  onCloseContext,
  title, workspaceName, contextCount, onOpenContext, onView, navigationSurface, primarySurface,
}: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drawerMode, setDrawerMode] = useState(() => window.matchMedia?.('(max-width: 1200px)').matches ?? false);
  const shellRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 1200px)');
    const changed = () => setDrawerMode(media?.matches ?? false);
    media?.addEventListener('change', changed);
    return () => media?.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    if (!sidebarOpen && !contextOpen) return;
    const drawer = sidebarOpen ? shellRef.current?.querySelector<HTMLElement>('.sidebar') : shellRef.current?.querySelector<HTMLElement>('.context-panel');
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!sidebarOpen && !drawerMode) return;
    const background = [...(shellRef.current?.querySelectorAll<HTMLElement>('.workbench-main, .mobile-navigation, .sidebar') || [])].filter(element => element !== drawer);
    const inertBefore = background.map(element => element.inert);
    background.forEach(element => { element.inert = true; });
    const previousRole = drawer?.getAttribute('role');
    drawer?.setAttribute('role', 'dialog'); drawer?.setAttribute('aria-modal', 'true');
    const controls = () => [...(drawer?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [href]') || [])].filter(element => element.getClientRects().length > 0);
    controls()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') { event.preventDefault(); setSidebarOpen(false); onCloseContext(); }
      if (event.key !== 'Tab') return;
      const items = controls(); const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      background.forEach((element, index) => { element.inert = inertBefore[index]; });
      if (previousRole) drawer?.setAttribute('role', previousRole); else drawer?.removeAttribute('role');
      drawer?.removeAttribute('aria-modal'); previous?.focus();
    };
  }, [sidebarOpen, contextOpen, drawerMode, onCloseContext]);
  return <div ref={shellRef} className={`app-shell workbench-shell ${contextOpen ? 'context-open' : ''} ${sidebarOpen ? 'sidebar-open' : ''} ${sidebarCollapsed ? 'nav-collapsed' : ''}`} onClick={event => {
    if (sidebarOpen && event.target instanceof Element && event.target.closest('.sidebar .nav-item, .sidebar .tree-thread, .sidebar .active-path-card button')) setSidebarOpen(false);
  }}>
    <a className="skip-link" href="#workspace-main" onClick={event => { event.preventDefault(); const main = document.getElementById('workspace-main'); main?.setAttribute('tabindex', '-1'); main?.focus(); }}>跳到主要内容</a>
    <div className="network-status" aria-live="polite" role="status">{networkNotice}</div>
    <button className="sidebar-backdrop" aria-label="关闭工作区菜单" onClick={() => setSidebarOpen(false)}/>
    {sidebar}
    <div className="workbench-main">
    <header className="workbench-header">
      <button className="desktop-navigation-toggle" aria-label={sidebarCollapsed ? '展开导航' : '收起导航'} title={sidebarCollapsed ? '展开导航' : '收起导航'} aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed(value => !value)}>{sidebarCollapsed ? <PanelLeftOpen size={18}/> : <PanelLeftClose size={18}/>}</button>
      <button className="workspace-menu-button" aria-label="打开工作区菜单" aria-expanded={sidebarOpen} onClick={() => { setSidebarOpen(value => !value); onCloseContext(); }}><Menu size={20}/></button>
      <div className="workbench-title"><span>{workspaceName || 'RHIZA'}</span>{view === 'chat' && !primarySurface ? <h1>{title || '工作区'}</h1> : <strong>{title || '工作区'}</strong>}</div>
      <div className="workbench-header-actions">
        {onView && view === 'chat' && <button className="icon-button" aria-label="查看执行历史" title="查看执行历史" onClick={() => onView('runs')}><History size={18}/></button>}
        {onOpenContext && <button className={`context-chip ${contextOpen ? 'active' : ''}`} aria-label={contextCount === undefined ? '上下文' : `上下文 ${contextCount}`} aria-expanded={contextOpen} onClick={onOpenContext}><PanelRight size={16}/><span className="context-label">上下文</span>{contextCount !== undefined && <b>{contextCount}</b>}</button>}
        {navigationSurface && <DisclosureMenu label="位置与导航" trigger={<ChevronDown size={18}/>}>{navigationSurface}</DisclosureMenu>}
      </div>
    </header>
    <div className="workbench-content">
    {primarySurface ?? <>{!hasDiscussionNodes && view !== 'graph' && emptySurface}{(hasDiscussionNodes || view !== 'chat') && view !== 'runs' && surfaces[view]}{view === 'runs' && surfaces.runs}</>}
    </div>
    </div>
    {contextOpen && <button className="context-backdrop" aria-label="关闭上下文面板" onClick={onCloseContext}/>}
    {contextOpen && contextSurface}
    {onView && <nav className="mobile-navigation" aria-label="主要导航">
      {([['chat', '对话'], ['graph', '图谱'], ['runs', '历史']] as const).map(([target, label]) => <button key={target} aria-current={view === target ? 'page' : undefined} onClick={() => { setSidebarOpen(false); onView(target); }}>{label}</button>)}
      <button aria-expanded={sidebarOpen} onClick={() => { setSidebarOpen(value => !value); onCloseContext(); }}>工作区</button>
    </nav>}
    {overlayLayer}
  </div>;
}
