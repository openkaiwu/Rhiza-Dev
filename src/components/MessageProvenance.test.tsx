import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { MessageProvenance } from './MessageProvenance';
import type { ProvenanceLink } from '../types';

afterEach(() => vi.restoreAllMocks());
const link: ProvenanceLink = { id: 'p', outputRef: 'output', inputRefs: ['input'], runRef: 'run', status: 'broken-reference', missingRefs: ['blob:missing'] };
it('loads on demand and displays missing history explicitly', async () => {
  const read = vi.spyOn(api, 'getProvenance').mockResolvedValue(link);
  render(<MessageProvenance outputId="output"/>);
  expect(read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '查看来源' }));
  expect(await screen.findByText('来源存在缺失引用')).toBeInTheDocument();
  expect(screen.getByText('缺失：blob:missing')).toBeInTheDocument();
  expect(screen.getByText('run')).toBeInTheDocument();
});
it('ignores an old request when the displayed output changes', async () => {
  let finish!: (value: ProvenanceLink) => void;
  const old = new Promise<ProvenanceLink>(resolve => { finish = resolve; });
  vi.spyOn(api, 'getProvenance').mockReturnValueOnce(old).mockResolvedValue({ ...link, outputRef: 'new', status: 'pre-run', missingRefs: [] });
  const { rerender } = render(<MessageProvenance outputId="old"/>);
  fireEvent.click(screen.getByRole('button'));
  rerender(<MessageProvenance outputId="new"/>);
  await screen.findByText('旧记录：没有完整执行快照');
  finish(link);
  await waitFor(() => expect(screen.queryByText('来源存在缺失引用')).not.toBeInTheDocument());
});

it('navigates through the recorded Manifest and Run references without dispatching', async () => {
  vi.spyOn(api, 'getProvenance').mockResolvedValue({ ...link, contextManifestRef: 'frozen-manifest', status: 'purged' });
  const context = vi.fn(); const run = vi.fn();
  render(<MessageProvenance outputId="output" onInspectContext={context} onOpenRun={run}/>);
  fireEvent.click(screen.getByRole('button', { name: '查看来源' }));
  await screen.findByText(/内容已永久清除/);
  fireEvent.click(screen.getByRole('button', { name: '查看历史上下文' }));
  fireEvent.click(screen.getByRole('button', { name: '执行记录与回放' }));
  expect(context).toHaveBeenCalledWith('frozen-manifest'); expect(run).toHaveBeenCalledWith('run');
});
