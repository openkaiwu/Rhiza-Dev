import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { contextHistoryFixture } from '../test/context-history-fixture';
import { ContextHistoryPanel } from './ContextHistoryPanel';

it('explains frozen selections, omissions, over-budget priority and missing sources', () => {
  const onBack = vi.fn();
  render(<ContextHistoryPanel history={{ messageId: 'message', loading: false, data: contextHistoryFixture }} onBack={onBack} onRetry={vi.fn()}/>);
  expect(screen.getByText('为什么使用')).toBeInTheDocument();
  expect(screen.getByText('为什么未使用')).toBeInTheDocument();
  expect(screen.getByText(/显式选择超过预算/)).toBeInTheDocument();
  expect(screen.getByText(/来源记录缺失/)).toBeInTheDocument();
  expect(screen.getByText('用户明确排除：该假设已被最新访谈否定。')).toBeInTheDocument();
  expect(screen.getByText('手动选择')).toBeInTheDocument();
  expect(screen.getByText('fe2389a3-7525-463b-a8d1-c86743801321')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '返回当前上下文' }));
  expect(onBack).toHaveBeenCalledOnce();
});

it('shows loading and retriable errors without claiming sources are resolved', () => {
  const onRetry = vi.fn();
  const view = render(<ContextHistoryPanel history={{ messageId: 'message', loading: true }} onBack={vi.fn()} onRetry={onRetry}/>);
  expect(screen.getByRole('status')).toHaveTextContent('正在读取');
  view.rerender(<ContextHistoryPanel history={{ messageId: 'message', loading: false, error: '读取失败' }} onBack={vi.fn()} onRetry={onRetry}/>);
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  expect(onRetry).toHaveBeenCalledOnce();
  expect(screen.queryByText('为什么使用')).not.toBeInTheDocument();
});
