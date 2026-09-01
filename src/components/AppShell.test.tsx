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
