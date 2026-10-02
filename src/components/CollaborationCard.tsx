import { useState } from 'react';
import { GitCompareArrows, X } from 'lucide-react';
import type { CollaborationInput, CollaborationMode, CollaborationRecord, ProviderCatalog } from '../types';
import { MarkdownContent } from './MarkdownContent';

export const collaborationModes: Record<CollaborationMode, string> = { 'independent-review': '独立评审', 'peer-review': '交叉评审', debate: '辩论', 'second-opinion': '第二意见' };
const statuses: Record<string, string> = { running: '进行中', synthesizing: '正在汇总', completed: '已完成', partial: '部分意见', failed: '失败', canceled: '已停止', interrupted: '已中断', 'budget-exhausted': '预算已用尽' };

export function CollaborationForm({ prompt, catalog, attachmentIds, busy, onStart, onClose, onSettings }: { prompt: string; catalog: ProviderCatalog; attachmentIds: string[]; busy: boolean; onStart: (input: CollaborationInput) => Promise<boolean>; onClose: () => void; onSettings: () => void }) {
  const available = catalog.models.filter(model => catalog.providers.some(provider => provider.id === model.providerId && provider.configured));
  const [question, setQuestion] = useState(prompt);
  const [models, setModels] = useState<string[]>(available.slice(0, 2).map(model => model.id));
  const [mode, setMode] = useState<CollaborationMode>('independent-review');
  const [rounds, setRounds] = useState(2);
  const [synthesizer, setSynthesizer] = useState(models[0] ?? '');
  const selected = models.filter(id => available.some(model => model.id === id));
  const valid = question.trim() && selected.length >= 2 && selected.length <= 4 && selected.includes(synthesizer);
  return <section className="collaboration-card collaboration-form" aria-label="发起多模型协作">
    <header><h2><GitCompareArrows size={16}/>多模型协作</h2><button className="icon-button" aria-label="关闭协作配置" onClick={onClose} disabled={busy}><X size={16}/></button></header>
    <p>围绕当前讨论评审。发起时固定问题、对话历史和来源版本，结果可纳入本讨论继续使用。</p>
    <label className="collaboration-question">协作问题<textarea aria-label="协作问题" value={question} maxLength={32000} rows={2} disabled={busy} onChange={event => setQuestion(event.target.value)}/></label>
    <fieldset disabled={busy}><legend>参与模型 · 选择 2–4 个</legend><div className="collaboration-models">{available.map(model => <label key={model.id}><input type="checkbox" aria-label={`${model.displayName} ${catalog.providers.find(provider => provider.id === model.providerId)?.name ?? ''}`} checked={selected.includes(model.id)} disabled={!selected.includes(model.id) && selected.length >= 4} onChange={event => {
      const next = event.target.checked ? [...selected, model.id] : selected.filter(id => id !== model.id);
      setModels(next); if (!next.includes(synthesizer)) setSynthesizer(next[0] ?? '');
    }}/><span>{model.displayName}<small>{catalog.providers.find(provider => provider.id === model.providerId)?.name}</small></span></label>)}</div></fieldset>
    {available.length < 2 && <p role="status">至少需要两个已配置模型。<button onClick={onSettings}>配置模型</button></p>}
    <div className="collaboration-options"><label>协作方式<select aria-label="协作方式" disabled={busy} value={mode} onChange={event => setMode(event.target.value as CollaborationMode)}>{Object.entries(collaborationModes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>汇总模型<select aria-label="汇总模型" disabled={busy} value={synthesizer} onChange={event => setSynthesizer(event.target.value)}>{selected.map(id => <option key={id} value={id}>{available.find(model => model.id === id)?.displayName}</option>)}</select></label>{['peer-review', 'debate'].includes(mode) && <label>轮数<select aria-label="协作轮数" disabled={busy} value={rounds} onChange={event => setRounds(Number(event.target.value))}>{[2, 3, 4, 5].map(value => <option key={value} value={value}>{value} 轮</option>)}</select></label>}</div>
    <footer><span>{attachmentIds.length ? `${attachmentIds.length} 个附件 · ` : ''}最多 32,000 tokens · 3 分钟</span><button className="primary-button" disabled={busy || !valid} onClick={async () => { if (await onStart({ prompt: question.trim(), mode, modelIds: [...selected], synthesisModelId: synthesizer, attachmentIds: [...attachmentIds], maxRounds: ['peer-review', 'debate'].includes(mode) ? rounds : 1 })) onClose(); }}>{busy ? '协作进行中…' : '开始协作'}</button></footer>
  </section>;
}

export function CollaborationCard({ record, busy, running, retained, streams, onAction, onStop, onInspectContext, onOpenRun }: { record: CollaborationRecord; busy: boolean; running: boolean; retained: boolean; streams: Record<string, { participantId: string; round: number; text: string }>; onAction: (operation: 'retry' | 'synthesize' | 'retain' | 'refresh', attemptId?: string) => void; onStop: () => void; onInspectContext?: (manifestId: string) => void; onOpenRun?: (runId: string) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const modelName = (id: string) => record.models?.find(model => model.id === id)?.displayName ?? (id === '@synthesis' ? '综合意见' : id);
  const availableRetry = ['running', 'interrupted', 'partial', 'failed'].includes(record.status) && !record.cancelRequestedAt && Date.parse(record.budget.deadlineAt) > Date.now();
  const synthesisAttempt = record.attempts.filter(attempt => attempt.participantId === '@synthesis').at(-1);
  const canSynthesize = ['running', 'interrupted'].includes(record.status) && !record.synthesis && record.attempts.some(attempt => attempt.participantId !== '@synthesis' && attempt.status === 'completed') && !record.attempts.some(attempt => attempt.status === 'running') && (!synthesisAttempt || record.attempts.some(attempt => attempt.participantId !== '@synthesis' && attempt === record.attempts.at(-1) && attempt.status === 'completed'));
  return <section id={`collaboration-${record.id}`} className={`collaboration-card ${collapsed ? 'collapsed' : ''}`} aria-label={`${collaborationModes[record.mode]}协作结果`}>
    <header><h2><GitCompareArrows size={16}/>{collaborationModes[record.mode]}<span>{retained ? '已纳入讨论' : statuses[record.status]}</span></h2><button aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? '展开' : '收起'}</button></header>
    <p className="collaboration-frozen-question">{record.base.prompt}</p>
    {!collapsed && <>
      <details className="collaboration-frozen"><summary>固定输入 · {record.participants.length} 个模型 · {record.base.contextItems.length} 个来源</summary><p>发起于 {new Date(record.createdAt).toLocaleString()} · {record.budget.maxRounds} 轮 · {record.budget.usedTokens.toLocaleString()} / {record.budget.tokenLimit.toLocaleString()} tokens</p><ul>{record.base.contextItems.map(item => <li key={item.id}>{item.title}{item.pinned ? ' · 已固定' : ''}</li>)}</ul>{record.attempts[0] && onInspectContext && <button onClick={() => onInspectContext(record.attempts[0].manifestRef)}>查看固定来源</button>}</details>
      <div className="collaboration-participants">{[...record.participants, ...(synthesisAttempt ? ['@synthesis'] : [])].map(participantId => {
        const attempt = record.attempts.filter(item => item.participantId === participantId).at(-1);
        const progress = Object.values(streams).filter(item => item.participantId === participantId).at(-1);
        return <article key={participantId}><header><strong>{modelName(participantId)}</strong><span>{attempt ? `${statuses[attempt.status]} · 第 ${attempt.round} 轮` : progress ? `正在生成 · 第 ${progress.round} 轮` : record.status === 'canceled' ? '未执行' : '等待执行'}</span></header>{(attempt?.text || progress?.text) && <details open={busy && !!progress?.text}><summary>查看意见</summary><MarkdownContent content={attempt?.text ?? progress?.text ?? ''}/></details>}{attempt?.errorCode && <p role="status">未取得完整意见（{attempt.errorCode}）</p>}<div className="collaboration-participant-actions">{attempt && ['failed', 'interrupted', 'canceled'].includes(attempt.status) && availableRetry && <button disabled={busy || retained} onClick={() => onAction('retry', attempt.id)}>重试 {modelName(participantId)}</button>}{attempt && onOpenRun && <button onClick={() => onOpenRun(attempt.runRef)}>执行记录</button>}</div></article>;
      })}</div>
      {record.synthesis && <div className="collaboration-synthesis"><h3>综合建议</h3><MarkdownContent content={record.synthesis.recommendation}/><p>{record.synthesis.rationale}</p>{!!record.synthesis.missingParticipants.length && <p className="collaboration-missing" role="status">部分意见：{record.synthesis.missingParticipants.map(item => modelName(item.participantId)).join('、')}未提供完整结果，不代表一致结论。</p>}{!!record.synthesis.disagreements.length && <details><summary>分歧 · {record.synthesis.disagreements.length}</summary>{record.synthesis.disagreements.map((item, index) => <p key={index}>{item.summary}</p>)}</details>}{!!record.synthesis.risks.length && <details><summary>风险 · {record.synthesis.risks.length}</summary><ul>{record.synthesis.risks.map(risk => <li key={risk}>{risk}</li>)}</ul></details>}{!!record.synthesis.alternatives.length && <details><summary>备选方案</summary>{record.synthesis.alternatives.map(item => <article key={item.option}><strong>{item.option}</strong><p>{item.applicability}</p><p>优点：{item.pros.join('、')}；限制：{item.cons.join('、')}</p></article>)}</details>}</div>}
      <footer><button disabled={busy} onClick={() => onAction('refresh')}>重新读取记录</button>{(!busy || running) && ['running', 'synthesizing'].includes(record.status) && !retained && <button onClick={onStop}>停止协作</button>}{canSynthesize && <button disabled={busy || retained} onClick={() => onAction('synthesize')}>汇总当前意见</button>}{record.synthesis && <button className="primary-button" disabled={busy || retained} onClick={() => onAction('retain')}>{retained ? '已纳入当前讨论' : '纳入当前讨论'}</button>}</footer>
    </>}
  </section>;
}
