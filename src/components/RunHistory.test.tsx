import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { RunHistory } from './RunHistory';
import type { ExecutionRun } from '../types';

afterEach(() => vi.restoreAllMocks());
const run: ExecutionRun = { id: 'run-1', commandId: 'command-1', workspaceId: 'workspace', nodeId: 'node', status: 'running', attempt: 1, inputHash: 'abc', createdAt: '2026-08-31T00:00:00Z', input: { executor: { runtime: 'provider', modelSpecRef: 'model', providerEndpointRef: 'endpoint', model: 'Test model', provider: 'Test endpoint' }, request: { prompt: 'Hello', manifestId: 'manifest' } }, telemetry: { traceCount: 10 } };

it('filters recent runs while keeping the exact focused run and its recovery actions reachable', async () => {
  const completed = { ...run, id: 'completed', status: 'completed' as const };
  const failed = { ...run, id: 'failed', status: 'failed' as const, input: { ...run.input, executor: { ...run.input.executor, model: 'Other model' } } };
  const focused = { ...run, id: 'old-run' };
  const list = vi.spyOn(api, 'listRuns').mockResolvedValue({ runs: [completed, failed] });
  render(<RunHistory onChanged={vi.fn()} focusedRun={focused}/>);
  await screen.findByRole('article', { name: '失败 · Other model' });
  fireEvent.change(screen.getByLabelText('执行状态'), { target: { value: 'completed' } });
  expect(screen.queryByRole('article', { name: '失败 · Other model' })).not.toBeInTheDocument();
  expect(screen.getByRole('article', { name: '已完成 · Test model' })).toBeVisible();
  expect(within(screen.getByRole('article', { name: '生成中 · Test model' })).getByRole('button', { name: '停止' })).toBeVisible();
  expect(screen.getByText('已保留当前定位的执行记录。')).toBeVisible();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索执行历史' }), { target: { value: 'missing-model' } });
  expect(screen.getByText('匹配 0 / 已加载 3')).toBeVisible();
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(list).toHaveBeenCalledOnce();
});

it('shows initial loading and errors without claiming the history is empty', async () => {
  let reject!: (reason: Error) => void;
  vi.spyOn(api, 'listRuns').mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValue({ runs: [] });
  render(<RunHistory onChanged={vi.fn()}/>);
  expect(screen.getByText('正在加载执行历史…')).toBeVisible();
  expect(screen.queryByText('尚无执行记录')).not.toBeInTheDocument();
  await act(async () => reject(new Error('offline')));
  expect(screen.getByRole('alert')).toHaveTextContent('无法加载执行历史');
  expect(screen.queryByText('尚无执行记录')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  expect(await screen.findByText('尚无执行记录')).toBeVisible();
});

it('requires an explicit replay policy and reuses the retry key after failure', async () => {
  vi.spyOn(api, 'listRuns').mockResolvedValue({ runs: [{ ...run, status: 'completed' }] });
  vi.spyOn(api, 'getReplayPreflight').mockResolvedValue({ runId: run.id, missingRefs: [], policies: [{ policy: 'exact', allowed: true, differences: [] }, { policy: 'partial', allowed: true, differences: ['模型配置不同'] }] });
  const replay = vi.spyOn(api, 'replayRun').mockRejectedValueOnce(new Error('历史资源缺失')).mockResolvedValue({ replay: { classification: 'partial' } });
  const changed = vi.fn();
  render(<RunHistory onChanged={changed}/>);
  fireEvent.click(await screen.findByText('历史回放'));
  fireEvent.change(await screen.findByLabelText('回放策略'), { target: { value: 'partial' } });
  expect(screen.getByRole('button', { name: '按所选策略回放' })).toBeDisabled();
  fireEvent.click(screen.getByLabelText('我接受以上配置差异'));
  fireEvent.click(screen.getByRole('button', { name: '按所选策略回放' }));
  await screen.findByText('历史资源缺失');
  fireEvent.click(screen.getByRole('button', { name: '按所选策略回放' }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(replay.mock.calls[0]).toEqual(replay.mock.calls[1]);
  expect(replay.mock.calls[0].slice(0, 2)).toEqual(['run-1', 'partial']);
  expect(screen.getByText('回放已完成：partial。')).toBeInTheDocument();
});

it('stops on the server and displays the durable canceled state', async () => {
  vi.spyOn(api, 'listRuns').mockResolvedValueOnce({ runs: [run] }).mockResolvedValue({ runs: [{ ...run, status: 'canceled', error: { code: 'GENERATION_STOPPED', class: 'canceled', message: '用户已停止生成。' } }] });
  const cancel = vi.spyOn(api, 'cancelRun').mockResolvedValue({ run: { ...run, status: 'canceled' } });
  const changed = vi.fn();
  render(<RunHistory onChanged={changed}/>);
  fireEvent.click(await screen.findByRole('button', { name: '停止' }));
  await screen.findByRole('article', { name: '已取消 · Test model' });
  expect(cancel).toHaveBeenCalledWith('run-1');
  expect(changed).toHaveBeenCalledOnce();
  expect(screen.getByText(/GENERATION_STOPPED/)).toBeInTheDocument();
});

it('does not apply responses belonging to an unmounted workspace', async () => {
  let resolve!: (value: { runs: ExecutionRun[] }) => void;
  vi.spyOn(api, 'listRuns').mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValue({ runs: [] });
  const { rerender } = render(<RunHistory key="old" onChanged={() => undefined}/>);
  rerender(<RunHistory key="new" onChanged={() => undefined}/>);
  await waitFor(() => expect(api.listRuns).toHaveBeenCalledTimes(2));
  await act(async () => resolve({ runs: [run] }));
  expect(screen.queryByRole('article', { name: '生成中 · Test model' })).not.toBeInTheDocument();
});

it('retains the logical Retry identity when its response is lost',async()=>{
 vi.spyOn(api,'findAttemptRun').mockResolvedValue(null);
 vi.spyOn(api,'listRuns').mockResolvedValue({runs:[{...run,status:'failed'}]});vi.spyOn(api,'activateNode').mockResolvedValue({workspace:{} as never});const retry=vi.spyOn(api,'retryRun').mockRejectedValueOnce(new TypeError('lost response')).mockResolvedValue({} as never);
 render(<RunHistory onChanged={()=>{}}/>);fireEvent.click(await screen.findByRole('button',{name:'重新执行'}));await screen.findByText('操作未完成，请查看执行状态后重试。');fireEvent.click(screen.getByRole('button',{name:'重新执行'}));await waitFor(()=>expect(retry).toHaveBeenCalledTimes(2));expect(retry.mock.calls[1]![1]).toBe(retry.mock.calls[0]![1]);
});

it('reconciles a completed Retry after transport loss without another external attempt',async()=>{
 vi.spyOn(api,'listRuns').mockResolvedValue({runs:[{...run,status:'failed'}]});vi.spyOn(api,'activateNode').mockResolvedValue({workspace:{} as never});const retry=vi.spyOn(api,'retryRun').mockRejectedValueOnce(new TypeError('lost response'));vi.spyOn(api,'findAttemptRun').mockResolvedValue({...run,id:'child',status:'completed'});const changed=vi.fn();
 render(<RunHistory onChanged={changed}/>);fireEvent.click(await screen.findByRole('button',{name:'重新执行'}));await screen.findByText('操作未完成，请查看执行状态后重试。');fireEvent.click(screen.getByRole('button',{name:'重新执行'}));await waitFor(()=>expect(changed).toHaveBeenCalledOnce());expect(retry).toHaveBeenCalledOnce();
});

it('blocks all replay policies when frozen resources are missing without any model action', async () => {
  vi.spyOn(api, 'listRuns').mockResolvedValue({ runs: [{ ...run, status: 'completed' }] });
  const preflight = vi.spyOn(api, 'getReplayPreflight').mockResolvedValue({ runId: run.id, missingRefs: ['blob:missing'], policies: [{ policy: 'exact', allowed: false, differences: [] }, { policy: 'current-model', allowed: false, differences: [] }] });
  const replay = vi.spyOn(api, 'replayRun');
  render(<RunHistory onChanged={vi.fn()}/>);
  expect(preflight).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByText('历史回放'));
  await screen.findByText(/历史资源缺失或损坏，无法回放/);
  expect(screen.getByRole('button', { name: '按所选策略回放' })).toBeDisabled();
  expect(replay).not.toHaveBeenCalled();
});


it('shows the durable refreshed state instead of freezing a deep-linked running snapshot', async () => {
 const changed=vi.fn();vi.spyOn(api,'listRuns').mockResolvedValueOnce({runs:[run]}).mockResolvedValue({runs:[{...run,status:'canceled'}]});vi.spyOn(api,'cancelRun').mockResolvedValue({run:{...run,status:'canceled'}});
 render(<RunHistory focusedRun={run} onChanged={changed}/>);fireEvent.click(await screen.findByRole('button',{name:'停止'}));await screen.findByRole('article', { name: '已取消 · Test model' });expect(screen.queryByRole('button',{name:'停止'})).not.toBeInTheDocument();expect(changed).toHaveBeenCalledOnce();
});
