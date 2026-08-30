import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { RunHistory } from './RunHistory';
import type { ExecutionRun } from '../types';

afterEach(() => vi.restoreAllMocks());
const run: ExecutionRun = { id: 'run-1', workspaceId: 'workspace', nodeId: 'node', status: 'running', attempt: 1, inputHash: 'abc', createdAt: '2026-08-31T00:00:00Z', input: { executor: { runtime: 'provider', modelSpecRef: 'model', providerEndpointRef: 'endpoint', model: 'Test model', provider: 'Test endpoint' }, request: { prompt: 'Hello', manifestId: 'manifest' } }, telemetry: { traceCount: 10 } };

it('stops on the server and displays the durable canceled state', async () => {
  vi.spyOn(api, 'listRuns').mockResolvedValueOnce({ runs: [run] }).mockResolvedValue({ runs: [{ ...run, status: 'canceled', error: { code: 'GENERATION_STOPPED', class: 'canceled', message: '用户已停止生成。' } }] });
  const cancel = vi.spyOn(api, 'cancelRun').mockResolvedValue({ run: { ...run, status: 'canceled' } });
  const changed = vi.fn();
  render(<RunHistory onChanged={changed}/>);
  fireEvent.click(await screen.findByRole('button', { name: '停止' }));
  await screen.findByText('已取消 · Test model');
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
  expect(screen.queryByText('生成中 · Test model')).not.toBeInTheDocument();
});
