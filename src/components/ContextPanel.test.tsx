import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ContextItem, ContextPreview } from '../types';
import { ContextPanel } from './ContextPanel';

const savedSource: ContextItem = {
  id: 'saved-chunk', title: '已审阅付款证据', detail: '附件片段', role: 'Reference', status: 'active',
  tokens: 80, sourceType: 'chunk', sourceId: 'payment-chunk', sourceRevision: 'a'.repeat(64),
  selectionMode: 'AI_RECOMMENDED_ACCEPTED', reason: '已审阅的旧版本', content: '旧版本正文', pinned: true,
};
const readyPreview: ContextPreview = {
  mode: 'Assisted', items: [], recommendations: [], omissions: [], budget: 32_000, usedTokens: 0, overBudget: false,
};
function props(items: ContextItem[] = [savedSource]) {
  return {
    items, mode: 'Assisted' as const, nodes: [], segments: [], attachments: [],
    onMode: vi.fn(), onStatus: vi.fn(), onPin: vi.fn(), onAddSource: vi.fn(),
    onDecision: vi.fn(async () => undefined), onRefresh: vi.fn(),
  };
}

it('lets a user exclude saved Context after a failed preview without accepting a new version', () => {
  const callbacks = props();
  const view = render(<ContextPanel {...callbacks} error="来源已变化，请重新确认 Context 推荐。"/>);
  const source = screen.getByText('已审阅付款证据').closest('article')!;
  expect(within(source).queryByRole('button', { name: '取消固定' })).not.toBeInTheDocument();
  expect(screen.queryByText('旧版本正文')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '加入本轮' })).not.toBeInTheDocument();
  expect(callbacks.onDecision).not.toHaveBeenCalled();

  fireEvent.click(within(source).getByRole('button', { name: '排除' }));
  expect(callbacks.onStatus).toHaveBeenCalledExactlyOnceWith('saved-chunk', 'excluded');
  expect(callbacks.onPin).not.toHaveBeenCalled();
  expect(callbacks.onRefresh).not.toHaveBeenCalled();

  view.rerender(<ContextPanel {...callbacks} items={[{ ...savedSource, status: 'excluded', pinned: false }]} preview={readyPreview}/>);
  expect(screen.getByRole('tabpanel', { name: '生效来源' })).toHaveTextContent('本轮没有额外来源。');
  expect(screen.getByRole('progressbar', { name: '本轮上下文预算' })).toHaveAttribute('value', '0');
  expect(screen.getByRole('button', { name: '恢复选择' })).toBeEnabled();
  expect(callbacks.onDecision).not.toHaveBeenCalled();
});

it('keeps saved Context readable after a preview failure while denying archived Workspace changes', () => {
  const callbacks = props();
  render(<ContextPanel {...callbacks} readOnly error="无法预览本轮上下文。"/>);
  const source = screen.getByText('已审阅付款证据').closest('article')!;
  const exclude = within(source).getByRole('button', { name: '排除' });
  expect(exclude).toBeDisabled();
  fireEvent.click(exclude);
  expect(callbacks.onStatus).not.toHaveBeenCalled();
  expect(callbacks.onDecision).not.toHaveBeenCalled();
});
