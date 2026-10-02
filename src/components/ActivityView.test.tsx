import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { WorkspaceActivityItem } from '../types';
import { ActivityView } from './ActivityView';

const activity: WorkspaceActivityItem[] = [
  { id: 'event-3', sequence: 3, type: 'run.status.changed', title: '更新执行状态', detail: 'run · run-secret-id', occurredAt: '2026-08-31T12:00:00Z', aggregateType: 'run', aggregateId: 'run-secret-id' },
  { id: 'event-2', sequence: 2, type: 'conversation.run.committed', title: '完成一次对话', detail: 'conversation · node-id', occurredAt: '2026-08-31T11:00:00Z', aggregateType: 'conversation', aggregateId: 'node-id' },
  { id: 'event-1', sequence: 1, type: 'future.event', title: '新类型活动', detail: 'future · future-id', occurredAt: '2026-08-30T11:00:00Z', aggregateType: 'future', aggregateId: 'future-id' },
];

it('filters only the loaded events and keeps unknown events searchable without refreshing', () => {
  const refresh = vi.fn();
  render(<ActivityView activity={activity} loading={false} onRefresh={refresh}/>);
  fireEvent.change(screen.getByLabelText('活动类型'), { target: { value: 'run' } });
  expect(screen.getByText('更新执行状态')).toBeVisible();
  expect(screen.queryByText('完成一次对话')).not.toBeInTheDocument();
  expect(screen.getByText('匹配 1 / 已加载 3')).toBeVisible();
  fireEvent.change(screen.getByLabelText('活动类型'), { target: { value: 'all' } });
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索活动' }), { target: { value: 'future-id' } });
  expect(screen.getByText('新类型活动')).toBeVisible();
  expect(screen.queryByText('更新执行状态')).not.toBeInTheDocument();
  expect(refresh).not.toHaveBeenCalled();
});

it('groups dates in journal order and discloses complete event identity on demand', () => {
  render(<ActivityView activity={activity} loading={false} onRefresh={vi.fn()}/>);
  expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2);
  expect(screen.getAllByRole('article').map(row => within(row).getByRole('heading', { level: 3 }).textContent)).toEqual(activity.map(item => item.title));
  const row = screen.getAllByRole('article')[0]!;
  expect(within(row).getByText('run-secret-id', { exact: true })).not.toBeVisible();
  fireEvent.click(within(row).getByText('事件详情'));
  expect(within(row).getByText('run-secret-id', { exact: true })).toBeVisible();
  expect(within(row).getByText('run.status.changed')).toBeVisible();
});

it('distinguishes loading, failed loading, and an empty filter with recovery', () => {
  const refresh = vi.fn();
  const { rerender } = render(<ActivityView activity={[]} loading onRefresh={refresh}/>);
  expect(screen.getByText('正在加载活动…')).toBeVisible();
  expect(screen.queryByText('尚无活动记录')).not.toBeInTheDocument();
  rerender(<ActivityView activity={[]} loading={false} error="读取失败" onRefresh={refresh}/>);
  expect(screen.getByRole('alert')).toHaveTextContent('读取失败');
  expect(screen.queryByText('尚无活动记录')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  expect(refresh).toHaveBeenCalledOnce();
  rerender(<ActivityView activity={activity} loading={false} onRefresh={refresh}/>);
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索活动' }), { target: { value: 'no match' } });
  expect(screen.getByText('没有匹配的活动')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
  expect(screen.getByText('完成一次对话')).toBeVisible();
});
