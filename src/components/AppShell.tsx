import type { ReactNode } from 'react';
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
}: AppShellProps) {
  return <div className={`app-shell ${contextOpen ? 'context-open' : ''}`}>
    <a className="skip-link" href="#workspace-main">跳到主要内容</a>
    <div className="network-status" aria-live="polite" role="status">{networkNotice}</div>
    <div className="ambient-grid" aria-hidden="true"/>
    {sidebar}
    {!hasDiscussionNodes && emptySurface}
    {hasDiscussionNodes && view !== 'runs' && surfaces[view]}
    {view === 'runs' && surfaces.runs}
    <button className="context-backdrop" aria-label="关闭上下文面板" onClick={onCloseContext}/>
    {contextSurface}
    {overlayLayer}
  </div>;
}
