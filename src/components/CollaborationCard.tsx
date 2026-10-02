import { useState } from 'react';
import { Check, ChevronDown, GitCompareArrows, RotateCcw, X } from 'lucide-react';
import type { CollaborationInput, CollaborationMode, CollaborationRecord, ProviderCatalog } from '../types';
import { MarkdownContent } from './MarkdownContent';

export const collaborationModes: Record<CollaborationMode, string> = { 'independent-review': '独立评审', 'peer-review': '交叉评审', debate: '辩论', 'second-opinion': '第二意见' };
const statuses: Record<string, string> = { running: '进行中', synthesizing: '正在汇总', completed: '已完成', partial: '部分完成', failed: '未完成', canceled: '已停止', interrupted: '连接中断', 'budget-exhausted': '预算已用尽' };

export function CollaborationForm({ prompt, catalog, attachmentIds, busy, onStart, onClose, onSettings }: { prompt: string; catalog: ProviderCatalog; attachmentIds: string[]; busy: boolean; onStart: (input: CollaborationInput) => Promise<boolean>; onClose: () => void; onSettings: () => void }) {
  const available = catalog.models.filter(model => catalog.providers.some(provider => provider.id === model.providerId && provider.configured));
  const [question, setQuestion] = useState(prompt);
  const [models, setModels] = useState<string[]>(available.slice(0, 2).map(model => model.id));
  const [mode, setMode] = useState<CollaborationMode>('independent-review');
  const [rounds, setRounds] = useState(2);
  const [tokenLimit, setTokenLimit] = useState(32000);
  const [timeLimitMs, setTimeLimitMs] = useState(180000);
  const [synthesizer, setSynthesizer] = useState(models[0] ?? '');
  const selected = models.filter(id => available.some(model => model.id === id));
  const valid = question.trim() && selected.length >= 2 && selected.length <= 4 && selected.includes(synthesizer);
  return <section className="collaboration-card collaboration-form" aria-label="发起多模型协作">
    <header><h2><GitCompareArrows size={16}/>多模型协作</h2><button className="icon-button" aria-label="关闭协作配置" onClick={onClose} disabled={busy}><X size={16}/></button></header>
    <p>围绕当前讨论评审。发起时固定问题、对话历史和来源版本，结果可纳入本讨论继续使用。</p>
    <label className="collaboration-question">协作问题<textarea aria-label="协作问题" value={question} maxLength={32000} rows={2} disabled={busy} onChange={event => setQuestion(event.target.value)}/></label>
    <fieldset disabled={busy}><legend>参与模型 <span>已选 {selected.length} / 最多 4</span></legend><div className="collaboration-models">{available.map(model => <label key={model.id}><input type="checkbox" aria-label={`${model.displayName} ${catalog.providers.find(provider => provider.id === model.providerId)?.name ?? ''}`} checked={selected.includes(model.id)} disabled={!selected.includes(model.id) && selected.length >= 4} onChange={event => {
      const next = event.target.checked ? [...selected, model.id] : selected.filter(id => id !== model.id);
      setModels(next); if (!next.includes(synthesizer)) setSynthesizer(next[0] ?? '');
    }}/><span>{model.displayName}<small>{catalog.providers.find(provider => provider.id === model.providerId)?.name}</small></span></label>)}</div></fieldset>
    {available.length < 2 && <p role="status">至少需要两个已配置模型。<button onClick={onSettings}>配置模型</button></p>}
    <div className="collaboration-options"><label>协作方式<select aria-label="协作方式" disabled={busy} value={mode} onChange={event => setMode(event.target.value as CollaborationMode)}>{Object.entries(collaborationModes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>汇总模型<select aria-label="汇总模型" disabled={busy} value={synthesizer} onChange={event => setSynthesizer(event.target.value)}>{selected.map(id => <option key={id} value={id}>{available.find(model => model.id === id)?.displayName}</option>)}</select></label>{['peer-review', 'debate'].includes(mode) && <label>轮数<select aria-label="协作轮数" disabled={busy} value={rounds} onChange={event => setRounds(Number(event.target.value))}>{[2, 3, 4, 5].map(value => <option key={value} value={value}>{value} 轮</option>)}</select></label>}
      {/* Synthesis reserves 4,096 tokens; a total cap of 4k is invalid. */}
      <label>Token 预算<select aria-label="Token 预算" disabled={busy} value={tokenLimit} onChange={event => setTokenLimit(Number(event.target.value))}>{[8000, 16000, 32000].map(value => <option key={value} value={value}>{value / 1000}k tokens</option>)}</select></label>
      <label>时间预算<select aria-label="时间预算" disabled={busy} value={timeLimitMs} onChange={event => setTimeLimitMs(Number(event.target.value))}>{[30000, 60000, 120000, 180000].map(value => <option key={value} value={value}>{value / 1000} 秒</option>)}</select></label>
    </div>
    <footer><span>{attachmentIds.length ? `${attachmentIds.length} 个附件 · ` : ''}最多 {tokenLimit.toLocaleString()} tokens · {timeLimitMs < 60000 ? `${timeLimitMs / 1000} 秒` : `${timeLimitMs / 60000} 分钟`}</span><button className="primary-button" disabled={busy || !valid} onClick={async () => { if (await onStart({ prompt: question.trim(), mode, modelIds: [...selected], synthesisModelId: synthesizer, attachmentIds: [...attachmentIds], maxRounds: ['peer-review', 'debate'].includes(mode) ? rounds : 1, ...(tokenLimit !== 32000 ? { tokenLimit } : {}), ...(timeLimitMs !== 180000 ? { timeLimitMs } : {}) })) onClose(); }}>{busy ? '协作进行中…' : '开始协作'}</button></footer>
  </section>;
}

export function CollaborationCard({ record, busy, running, retained, streams, onAction, onStop, onInspectContext, onOpenRun }: { record: CollaborationRecord; busy: boolean; running: boolean; retained: boolean; streams: Record<string, { participantId: string; round: number; text: string }>; onAction: (operation: 'retry' | 'synthesize' | 'retain' | 'refresh', attemptId?: string) => void; onStop: () => void; onInspectContext?: (manifestId: string) => void; onOpenRun?: (runId: string) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const modelName = (id: string) => record.models?.find(model => model.id === id)?.displayName ?? (id === '@synthesis' ? '综合意见' : id);
  const availableRetry = ['running', 'interrupted', 'partial', 'failed'].includes(record.status) && !record.cancelRequestedAt && Date.parse(record.budget.deadlineAt) > Date.now();
  const synthesisAttempt = record.attempts.filter(attempt => attempt.participantId === '@synthesis').at(-1);
  const synthesisProgress = Object.values(streams).filter(item => item.participantId === '@synthesis').at(-1);
  const synthesisState = synthesisAttempt?.status ?? (synthesisProgress || record.status === 'synthesizing' ? 'running' : 'waiting');
  const canSynthesize = ['running', 'interrupted'].includes(record.status) && !record.synthesis && record.attempts.some(attempt => attempt.participantId !== '@synthesis' && attempt.status === 'completed') && !record.attempts.some(attempt => attempt.status === 'running') && (!synthesisAttempt || record.attempts.some(attempt => attempt.participantId !== '@synthesis' && attempt === record.attempts.at(-1) && attempt.status === 'completed'));
  const latestAttempts = record.participants.map(id => record.attempts.filter(attempt => attempt.participantId === id).at(-1));
  const completed = latestAttempts.filter(attempt => attempt?.status === 'completed').length;
  const incomplete = latestAttempts.filter(attempt => attempt && ['failed', 'interrupted', 'canceled'].includes(attempt.status)).length;
  return <section id={`collaboration-${record.id}`} className={`collaboration-card ${collapsed ? 'collapsed' : ''}`} aria-label={`${collaborationModes[record.mode]}协作结果`}>
    <header className="collaboration-heading">
      <div className="collaboration-title"><span className="collaboration-symbol"><GitCompareArrows size={20}/></span><div><h2>多模型协作</h2><p>{collaborationModes[record.mode]} · {record.participants.length} 位参与者</p></div></div>
      <div className="collaboration-heading-actions"><span className={`collaboration-badge ${record.status}`}>{retained ? '已纳入讨论' : statuses[record.status] ?? record.status}</span><button className="icon-button" aria-label={collapsed ? '展开协作详情' : '收起协作详情'} aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}><ChevronDown size={18}/></button></div>
    </header>
    <div className="collaboration-input"><p className="collaboration-frozen-question">{record.base.prompt}</p><span aria-label="冻结协作预算">同一份冻结输入 · {record.base.contextItems.length} 个来源 · 最多 {record.budget.maxRounds} 轮 · {record.budget.usedTokens.toLocaleString()} / {record.budget.tokenLimit.toLocaleString()} tokens · 截止 <time dateTime={record.budget.deadlineAt}>{new Date(record.budget.deadlineAt).toLocaleString()}</time></span></div>
    {!collapsed && <>
      <div className="collaboration-participants" role="group" aria-label="参与模型意见">{record.participants.map((participantId, index) => {
        const attempt = latestAttempts[index];
        const progress = Object.values(streams).filter(item => item.participantId === participantId).at(-1);
        const state = progress ? 'running' : attempt?.status ?? (record.status === 'canceled' ? 'canceled' : 'waiting');
        return <article key={participantId} className={`participant-result ${state}`}>
          <header><span className="participant-avatar">{String.fromCharCode(65 + index)}</span><strong>{modelName(participantId)}</strong><span className={`collaboration-badge ${state}`}>{progress ? '正在生成' : attempt ? statuses[attempt.status] ?? attempt.status : record.status === 'canceled' ? '未执行' : '等待执行'}</span></header>
          {(attempt?.text || progress?.text) ? <details open><summary>查看意见{attempt && <span>第 {attempt.round} 轮</span>}</summary><MarkdownContent content={progress?.text ?? attempt?.text ?? ''}/></details> : <p className="participant-placeholder">{state === 'running' ? '正在基于冻结的对话和来源给出意见…' : ['failed', 'interrupted'].includes(state) ? '本轮未取得完整意见，可复用原始输入重试。' : state === 'canceled' ? '已停止，本轮未取得完整意见。' : '等待模型开始评审。'}</p>}
          {attempt?.errorCode && <details className="participant-diagnostics"><summary>失败详情</summary><p>{attempt.errorCode}</p></details>}
          <div className="collaboration-participant-actions">{attempt && ['failed', 'interrupted', 'canceled'].includes(attempt.status) && availableRetry && <button disabled={busy || retained} onClick={() => onAction('retry', attempt.id)}><RotateCcw size={14}/>重试 {modelName(participantId)}</button>}{attempt && onOpenRun && <button onClick={() => onOpenRun(attempt.runRef)}>执行记录</button>}</div>
        </article>;
      })}</div>
      {!record.synthesis && (synthesisAttempt || synthesisProgress || record.status === 'synthesizing') && <div className="collaboration-synthesis" aria-label="综合意见">
        <h3><GitCompareArrows size={16}/>综合意见</h3>
        <p role="status" aria-label="汇总状态">{statuses[synthesisState] ?? synthesisState}</p>
        {(synthesisProgress?.text || synthesisAttempt?.text) ? <MarkdownContent content={synthesisProgress?.text ?? synthesisAttempt?.text ?? ''}/> : <p className="participant-placeholder">{synthesisState === 'running' ? '正在汇总参与模型的意见…' : ['failed', 'interrupted'].includes(synthesisState) ? '未取得完整综合意见，可复用原始输入重试。' : synthesisState === 'canceled' ? '汇总已停止。' : '等待汇总模型开始。'}</p>}
        {synthesisAttempt?.errorCode && <details className="participant-diagnostics"><summary>汇总失败详情</summary><p>{synthesisAttempt.errorCode}</p></details>}
        <div className="collaboration-participant-actions">{synthesisAttempt && ['failed', 'interrupted', 'canceled'].includes(synthesisAttempt.status) && availableRetry && <button disabled={busy || retained} onClick={() => onAction('retry', synthesisAttempt.id)}><RotateCcw size={14}/>重试 {modelName('@synthesis')}</button>}{synthesisAttempt && onOpenRun && <button onClick={() => onOpenRun(synthesisAttempt.runRef)}>汇总执行记录</button>}</div>
      </div>}
      {record.synthesis && <div className="collaboration-synthesis"><h3><Check size={16}/>综合建议</h3><MarkdownContent content={record.synthesis.recommendation}/><p>{record.synthesis.rationale}</p>{!!record.synthesis.missingParticipants.length && <p className="collaboration-missing" role="status">部分意见：{record.synthesis.missingParticipants.map(item => modelName(item.participantId)).join('、')}未提供完整结果，不代表一致结论。</p>}{!!record.synthesis.disagreements.length && <details><summary>分歧 · {record.synthesis.disagreements.length}</summary>{record.synthesis.disagreements.map((item, index) => <p key={index}>{item.summary}</p>)}</details>}{!!record.synthesis.risks.length && <details><summary>风险 · {record.synthesis.risks.length}</summary><ul>{record.synthesis.risks.map(risk => <li key={risk}>{risk}</li>)}</ul></details>}{!!record.synthesis.alternatives.length && <details><summary>备选方案</summary>{record.synthesis.alternatives.map(item => <article key={item.option}><strong>{item.option}</strong><p>{item.applicability}</p><p>优点：{item.pros.join('、')}；限制：{item.cons.join('、')}</p></article>)}</details>}</div>}
      <details className="collaboration-frozen"><summary>查看固定输入与来源 <span>{record.budget.usedTokens.toLocaleString()} / {record.budget.tokenLimit.toLocaleString()} tokens</span></summary><p>发起于 {new Date(record.createdAt).toLocaleString()} · {record.budget.maxRounds} 轮</p><ul>{record.base.contextItems.map(item => <li key={item.id}>{item.title}{item.pinned ? ' · 已固定' : ''}</li>)}</ul>{record.attempts[0] && onInspectContext && <button onClick={() => onInspectContext(record.attempts[0].manifestRef)}>查看固定来源</button>}{record.synthesis && synthesisAttempt && onOpenRun && <button onClick={() => onOpenRun(synthesisAttempt.runRef)}>汇总执行记录</button>}</details>
      <footer><span role="status" aria-label="协作进度">{completed} / {record.participants.length} 位已完成{incomplete ? ` · ${incomplete} 位未完成` : ''}{retained ? ' · 已用于后续讨论' : ''}</span><div><button className="icon-button" disabled={busy} aria-label="重新读取记录" title="重新读取记录" onClick={() => onAction('refresh')}><RotateCcw size={15}/></button>{(!busy || running) && ['running', 'synthesizing'].includes(record.status) && !retained && <button onClick={onStop}>停止协作</button>}{canSynthesize && <button disabled={busy || retained} onClick={() => onAction('synthesize')}>汇总当前意见</button>}{record.synthesis && <button className="primary-button" disabled={busy || retained} onClick={() => onAction('retain')}>{retained ? '已纳入当前讨论' : '纳入当前讨论'}</button>}</div></footer>
    </>}
  </section>;
}
