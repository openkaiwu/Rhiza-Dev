import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';

const surfaces = {
  chat: <main>chat surface</main>,
  graph: <main>graph surface</main>,
  state: <main>state surface</main>,
  activity: <main>activity surface</main>,
  runs: <main>runs surface</main>,
};

describe('AppShell', () => {
  it('composes the selected surface, context surface, and overlay without owning application behavior', () => {
    const onCloseContext = vi.fn();
    const { container } = render(<AppShell
      view="graph"
      hasDiscussionNodes
      contextOpen
      networkNotice="网络已恢复"
      sidebar={<nav>sidebar</nav>}
      surfaces={surfaces}
      emptySurface={<main>empty surface</main>}
      contextSurface={<aside>context surface</aside>}
      overlayLayer={<div>overlay layer</div>}
      onCloseContext={onCloseContext}
    />);

    expect(container.firstElementChild).toHaveClass('app-shell', 'context-open');
    expect(screen.getByText('graph surface')).toBeInTheDocument();
    expect(screen.queryByText('chat surface')).not.toBeInTheDocument();
    expect(screen.getByText('context surface')).toBeInTheDocument();
    expect(screen.getByText('overlay layer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭上下文面板' }));
    expect(onCloseContext).toHaveBeenCalledOnce();
  });

  it('preserves the empty workspace alongside the run-history surface', () => {
    render(<AppShell
      view="runs"
      hasDiscussionNodes={false}
      contextOpen={false}
      networkNotice=""
      sidebar={<nav>sidebar</nav>}
      surfaces={surfaces}
      emptySurface={<main>empty surface</main>}
      contextSurface={<aside>context surface</aside>}
      onCloseContext={() => undefined}
    />);

    expect(screen.getByText('empty surface')).toBeInTheDocument();
    expect(screen.getByText('runs surface')).toBeInTheDocument();
  });
});

it('releases the context rail and keeps mobile navigation inside the same workspace', () => {
  const onView = vi.fn(); const open = vi.fn();
  render(<AppShell view="chat" hasDiscussionNodes contextOpen={false} networkNotice="" sidebar={<nav>sidebar</nav>} surfaces={surfaces} emptySurface={<main>empty</main>} contextSurface={<aside>context surface</aside>} onCloseContext={vi.fn()} onOpenContext={open} onView={onView} title="当前讨论" contextCount={3}/>);
  expect(screen.queryByText('context surface')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '关闭上下文面板' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '上下文 3' })); expect(open).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '图谱' })); expect(onView).toHaveBeenCalledWith('graph');
  expect(screen.queryByRole('button', { name: '协作' })).not.toBeInTheDocument();
});

it('closes the sidebar after navigation but leaves tree expansion inside the drawer', () => {
  const navigate = vi.fn();
  const { container } = render(<AppShell view="runs" hasDiscussionNodes contextOpen={false} networkNotice="" sidebar={<aside className="sidebar"><button className="tree-toggle">展开讨论</button><button className="nav-item" onClick={navigate}><span>活动时间线</span></button></aside>} surfaces={surfaces} emptySurface={<main>empty</main>} contextSurface={<aside>context</aside>} onCloseContext={vi.fn()}/>);
  const main = container.querySelector('.workbench-main') as HTMLElement;
  main.inert = false;
  fireEvent.click(screen.getByRole('button', { name: '打开工作区菜单' }));
  expect(container.firstElementChild).toHaveClass('sidebar-open');
  fireEvent.click(screen.getByRole('button', { name: '展开讨论' }));
  expect(container.firstElementChild).toHaveClass('sidebar-open');
  fireEvent.click(screen.getByText('活动时间线'));
  expect(navigate).toHaveBeenCalledOnce();
  expect(container.firstElementChild).not.toHaveClass('sidebar-open');
  expect(screen.getByRole('button', { name: '打开工作区菜单' })).toHaveAttribute('aria-expanded', 'false');
  expect(main.inert).toBe(false);
});
