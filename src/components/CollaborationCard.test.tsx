import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CollaborationCard, CollaborationForm } from './CollaborationCard';
import type { CollaborationRecord, ProviderCatalog } from '../types';
const catalog: ProviderCatalog = { providers: [{ id: 'p', name: 'Fixture', configured: true, preset: 'custom', baseUrl: 'https://example.test', chatPath: '/chat', allowNoKey: true, hasApiKey: false, createdAt: '', updatedAt: '' }], activeModelId: 'a', models: ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, providerId: 'p', modelId: id, displayName: id, favorite: false, pinned: false, createdAt: '' })) };
const record: CollaborationRecord = { id: 'collaboration', workspaceId: 'workspace', nodeId: 'internal-branch', revision: 6, mode: 'second-opinion', participants: ['a', 'b'], synthesisModelId: 'a', base: { workspaceId: 'workspace', nodeId: 'conversation', contextBaseHash: 'a'.repeat(64), prompt: 'Review current answer', contextItems: [], history: [], attachmentIds: [] }, status: 'partial', createdAt: '2026-10-02T00:00:00Z', budget: { tokenLimit: 32000, synthesisTokens: 0, usedTokens: 20, reservedTokens: 0, deadlineAt: '2099-10-02T00:00:00Z', maxRounds: 1 }, attempts: [{ id: 'attempt-a', participantId: 'a', round: 1, attempt: 1, status: 'completed', runRef: 'run-a', manifestRef: 'manifest-a', outputRef: 'output-a', text: 'A completed' }, { id: 'attempt-b', participantId: 'b', round: 1, attempt: 1, status: 'failed', runRef: 'run-b', manifestRef: 'manifest-b', errorCode: 'PROVIDER_TIMEOUT' }], synthesis: { recommendation: 'Partial advice', rationale: 'Only A available', alternatives: [], risks: [], disagreements: [{ summary: 'Evidence incomplete', sourceOutputRefs: ['output-a'] }], sourceOutputRefs: ['output-a'], missingParticipants: [{ participantId: 'b', status: 'failed' }] } };

it('limits configured model choices to 2–4 and sends the explicitly selected mode and attachments', async () => {
  const start = vi.fn().mockResolvedValue(true); const close = vi.fn();
  render(<CollaborationForm prompt="Review current answer" catalog={catalog} attachmentIds={['file-1']} busy={false} onStart={start} onClose={close} onSettings={vi.fn()}/>);
  fireEvent.click(screen.getByRole('checkbox', { name: 'c Fixture' })); fireEvent.click(screen.getByRole('checkbox', { name: 'd Fixture' }));
  expect(screen.getByRole('checkbox', { name: 'e Fixture' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('协作方式'), { target: { value: 'debate' } });
  fireEvent.change(screen.getByLabelText('协作轮数'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: '开始协作' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(start).toHaveBeenCalledWith({ prompt: 'Review current answer', mode: 'debate', modelIds: ['a', 'b', 'c', 'd'], synthesisModelId: 'a', maxRounds: 3, attachmentIds: ['file-1'] });
});

it('retries only the failed participant and retains a visibly partial result in its initiating conversation', () => {
  const action = vi.fn();
  const { rerender } = render(<CollaborationCard record={record} busy={false} running={false} retained={false} streams={{}} onAction={action} onStop={vi.fn()}/>);
  expect(screen.queryByRole('button', { name: '重试 a' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重试 b' })); expect(action).toHaveBeenCalledWith('retry', 'attempt-b');
  expect(screen.getByText(/不代表一致结论/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '纳入当前讨论' })); expect(action).toHaveBeenLastCalledWith('retain');
  rerender(<CollaborationCard record={record} busy={false} running={false} retained streams={{}} onAction={action} onStop={vi.fn()}/>);
  expect(screen.getByRole('button', { name: '已纳入当前讨论' })).toBeDisabled(); expect(screen.getByRole('button', { name: '重试 b' })).toBeDisabled();
});

it('shows durable Stop state and allows only a changed completed retry to request a new synthesis', () => {
  const action = vi.fn(); const stop = vi.fn();
  const running = { ...record, status: 'running' as const, synthesis: undefined, attempts: [...record.attempts, { ...record.attempts[1], id: 'retry-b', attempt: 2, status: 'completed' as const, text: 'Recovered B', outputRef: 'output-b' }] };
  const { rerender } = render(<CollaborationCard record={running} busy={false} running={false} retained={false} streams={{}} onAction={action} onStop={stop}/>);
  fireEvent.click(screen.getByRole('button', { name: '汇总当前意见' })); expect(action).toHaveBeenCalledWith('synthesize');
  fireEvent.click(screen.getByRole('button', { name: '停止协作' })); expect(stop).toHaveBeenCalledOnce();
  rerender(<CollaborationCard record={{ ...running, status: 'canceled', cancelRequestedAt: '2026-10-02T00:00:01Z' }} busy={false} running={false} retained={false} streams={{}} onAction={action} onStop={stop}/>);
  expect(screen.queryByRole('button', { name: '停止协作' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: '汇总当前意见' })).not.toBeInTheDocument();
});
