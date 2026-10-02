import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

it('sends the selected collaboration budget within backend limits and disables changes while busy', async () => {
  const start = vi.fn().mockResolvedValue(true); const close = vi.fn();
  const props = { prompt: 'Review current answer', catalog, attachmentIds: ['file-1'], busy: false, onStart: start, onClose: close, onSettings: vi.fn() };
  const { rerender } = render(<CollaborationForm {...props}/>);
  const tokens = screen.getByRole('combobox', { name: 'Token 预算' });
  const duration = screen.getByRole('combobox', { name: '时间预算' });
  expect(tokens).toHaveValue('32000'); expect(duration).toHaveValue('180000');
  expect(within(tokens).getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(['8000', '16000', '32000']);
  expect(within(duration).getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(['30000', '60000', '120000', '180000']);
  fireEvent.change(tokens, { target: { value: '8000' } });
  fireEvent.change(duration, { target: { value: '30000' } });
  fireEvent.change(screen.getByLabelText('协作方式'), { target: { value: 'second-opinion' } });
  expect(start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '开始协作' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(start).toHaveBeenCalledExactlyOnceWith({ prompt: 'Review current answer', mode: 'second-opinion', modelIds: ['a', 'b'], synthesisModelId: 'a', maxRounds: 1, attachmentIds: ['file-1'], tokenLimit: 8000, timeLimitMs: 30000 });
  rerender(<CollaborationForm {...props} busy/>);
  expect(screen.getByRole('combobox', { name: 'Token 预算' })).toBeDisabled();
  expect(screen.getByRole('combobox', { name: '时间预算' })).toBeDisabled();
});

it('shows the frozen collaboration budget and absolute deadline even when details are collapsed', () => {
  const action = vi.fn();
  const frozen = { ...record, budget: { ...record.budget, tokenLimit: 16000, usedTokens: 1234, deadlineAt: '2026-10-02T00:01:00Z' } };
  render(<CollaborationCard record={frozen} busy={false} running={false} retained={false} streams={{}} onAction={action} onStop={vi.fn()}/>);
  const budget = screen.getByLabelText('冻结协作预算');
  expect(budget).toHaveTextContent(`${(1234).toLocaleString()} / ${(16000).toLocaleString()} tokens`);
  expect(budget).toHaveTextContent('截止');
  const deadline = budget.querySelector('time');
  expect(deadline).toHaveAttribute('datetime', frozen.budget.deadlineAt);
  expect(deadline).toHaveTextContent(new Date(frozen.budget.deadlineAt).toLocaleString());
  fireEvent.click(screen.getByRole('button', { name: '收起协作详情' }));
  expect(budget).toBeVisible();
  expect(action).not.toHaveBeenCalled();
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

it('separates synthesis from participant progress and keeps frozen evidence accessible', () => {
  const withSynthesis = { ...record, attempts: [...record.attempts, { ...record.attempts[0], id: 'synthesis', participantId: '@synthesis', text: 'Combined result' }] };
  render(<CollaborationCard record={withSynthesis} busy={false} running={false} retained={false} streams={{}} onAction={vi.fn()} onStop={vi.fn()}/>);
  const participants = screen.getByRole('group', { name: '参与模型意见' });
  expect(within(participants).getAllByRole('article')).toHaveLength(2);
  expect(screen.getByRole('status', { name: '协作进度' })).toHaveTextContent('1 / 2 位已完成');
  expect(screen.getByText(/固定输入/).closest('details')).not.toHaveAttribute('open');
  fireEvent.click(screen.getByRole('button', { name: '收起协作详情' }));
  expect(screen.queryByRole('group', { name: '参与模型意见' })).not.toBeInTheDocument();
  expect(screen.getByText('Review current answer')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '展开协作详情' }));
  expect(screen.getByRole('group', { name: '参与模型意见' })).toBeInTheDocument();
});

it.each(['failed', 'interrupted'] as const)('retries the original %s synthesis without repeating completed participants', status => {
  const action = vi.fn(); const openRun = vi.fn();
  const participants = record.attempts.map(attempt => ({ ...attempt, status: 'completed' as const, errorCode: undefined, outputRef: `output-${attempt.participantId}`, text: `${attempt.participantId} completed` }));
  const synthesis = { id: 'synthesis-failed', participantId: '@synthesis', round: 1, attempt: 1, status, runRef: 'run-synthesis', manifestRef: 'manifest-synthesis', errorCode: 'PROVIDER_TIMEOUT' };
  const failed: CollaborationRecord = { ...record, synthesis: undefined, status: 'interrupted', attempts: [...participants, synthesis] };
  const props = { record: failed, busy: false, running: false, retained: false, streams: {}, onAction: action, onStop: vi.fn(), onOpenRun: openRun };
  const { rerender } = render(<CollaborationCard {...props}/>);
  expect(screen.getByRole('status', { name: '汇总状态' })).toHaveTextContent(status === 'failed' ? '未完成' : '连接中断');
  expect(screen.getByText('汇总失败详情')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '汇总当前意见' })).not.toBeInTheDocument();
  expect(within(screen.getByRole('group', { name: '参与模型意见' })).queryByRole('button', { name: /重试/ })).not.toBeInTheDocument();
  expect(screen.getByRole('status', { name: '协作进度' })).toHaveTextContent('2 / 2 位已完成');
  expect(action).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重试 综合意见' }));
  expect(action).toHaveBeenCalledExactlyOnceWith('retry', 'synthesis-failed');
  fireEvent.click(screen.getByRole('button', { name: '汇总执行记录' }));
  expect(openRun).toHaveBeenCalledWith('run-synthesis');
  rerender(<CollaborationCard {...props} busy/>);
  expect(screen.getByRole('button', { name: '重试 综合意见' })).toBeDisabled();
  rerender(<CollaborationCard {...props} retained/>);
  expect(screen.getByRole('button', { name: '重试 综合意见' })).toBeDisabled();
  rerender(<CollaborationCard {...props} record={{ ...failed, status: 'canceled', cancelRequestedAt: '2026-10-02T00:00:01Z' }}/>);
  expect(screen.queryByRole('button', { name: '重试 综合意见' })).not.toBeInTheDocument();
  rerender(<CollaborationCard {...props} record={{ ...failed, budget: { ...failed.budget, deadlineAt: '2020-10-02T00:00:00Z' } }}/>);
  expect(screen.queryByRole('button', { name: '重试 综合意见' })).not.toBeInTheDocument();
});

it('displays synthesis stream fragments in a separate area before and after the attempt state arrives', () => {
  const participants = record.attempts.map(attempt => ({ ...attempt, status: 'completed' as const, errorCode: undefined, outputRef: `output-${attempt.participantId}`, text: `${attempt.participantId} completed` }));
  const synthesizing: CollaborationRecord = { ...record, status: 'synthesizing', synthesis: undefined, attempts: participants };
  const props = { busy: true, running: true, retained: false, onAction: vi.fn(), onStop: vi.fn(), onOpenRun: vi.fn() };
  const { rerender } = render(<CollaborationCard {...props} record={synthesizing} streams={{ 'run-synthesis': { participantId: '@synthesis', round: 1, text: '综合建议片段' } }}/>);
  expect(screen.getByRole('status', { name: '汇总状态' })).toHaveTextContent('进行中');
  expect(screen.getByText('综合建议片段')).toBeVisible();
  const modelOpinions = screen.getByRole('group', { name: '参与模型意见' });
  expect(within(modelOpinions).getAllByRole('article')).toHaveLength(2);
  expect(within(modelOpinions).queryByText('综合建议片段')).not.toBeInTheDocument();
  expect(screen.getByRole('status', { name: '协作进度' })).toHaveTextContent('2 / 2 位已完成');
  const withAttempt: CollaborationRecord = { ...synthesizing, attempts: [...participants, { id: 'synthesis-running', participantId: '@synthesis', round: 1, attempt: 1, status: 'running', runRef: 'run-synthesis', manifestRef: 'manifest-synthesis' }] };
  rerender(<CollaborationCard {...props} record={withAttempt} streams={{ 'run-synthesis': { participantId: '@synthesis', round: 1, text: '综合建议片段继续生成' } }}/>);
  expect(screen.getByText('综合建议片段继续生成')).toBeVisible();
  expect(screen.queryByRole('button', { name: '重试 综合意见' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '汇总执行记录' })).toBeEnabled();
});

it.each(['expired', 'exhausted'] as const)('explains an %s budget without offering another generation', budgetState => {
  const action = vi.fn(); const openRun = vi.fn();
  const limited: CollaborationRecord = {
    ...record, synthesis: undefined,
    status: budgetState === 'expired' ? 'interrupted' : 'budget-exhausted',
    budget: { ...record.budget, deadlineAt: budgetState === 'expired' ? '2020-01-01T00:00:00Z' : record.budget.deadlineAt },
    attempts: budgetState === 'exhausted' ? [record.attempts[0]] : record.attempts,
  };
  render(<CollaborationCard record={limited} busy={false} running={false} retained={false} streams={{}} onAction={action} onStop={vi.fn()} onOpenRun={openRun}/>);
  expect(screen.getByRole('status', { name: '协作预算提示' })).toHaveTextContent('调整预算重新发起');
  expect(screen.queryByRole('button', { name: '汇总当前意见' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /重试/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/可复用原始输入重试/)).not.toBeInTheDocument();
  expect(screen.getByText('A completed')).toBeVisible();
  if (budgetState === 'exhausted') expect(screen.getByText('因预算结束未执行。')).toBeVisible();
  fireEvent.click(screen.getAllByRole('button', { name: '执行记录' })[0]);
  expect(openRun).toHaveBeenCalledWith('run-a');
  expect(action).not.toHaveBeenCalled();
});
