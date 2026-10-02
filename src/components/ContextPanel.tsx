import { useState } from 'react';
import { Check, EyeOff, FileText, GitBranch, Layers3, LockKeyhole, PinOff, Plus, Sparkles, X } from 'lucide-react';
import type { Attachment, ContextItem, ContextMode, ContextPreview, ContextRecommendationDecision, ContextStatus, DiscussionNode, Segment } from '../types';
import { ContextHistoryPanel, type ContextHistoryState } from './ContextHistoryPanel';

interface ContextPanelProps {
  history?: ContextHistoryState;
  onBackToCurrent?: () => void;
  onRetryHistory?: () => void;
  items: ContextItem[];
  preview?: ContextPreview;
  loading?: boolean;
  error?: string;
  deciding?: boolean;
  onRefresh?: () => void;
  onDecision?: (decision: ContextRecommendationDecision) => Promise<void>;
  onClose?: () => void;
  mode: ContextMode;
  nodes: DiscussionNode[];
  segments: Segment[];
  attachments: Attachment[];
  onMode: (mode: ContextMode) => void | Promise<void>;
  onStatus: (id: string, status: ContextStatus) => void | Promise<void>;
  onPin: (id: string, pinned: boolean) => void | Promise<void>;
  onAddSource: (sourceType: 'node' | 'segment' | 'file', sourceId: string) => void | Promise<void>;
}

export function ContextPanel({ items, preview, loading, error, deciding, onRefresh, onDecision, onClose, mode, nodes, segments, attachments, onMode, onStatus, onPin, onAddSource, history, onBackToCurrent, onRetryHistory }: ContextPanelProps) {
  const [tab, setTab] = useState<'active' | 'recommended'>('active');
  const [reasons, setReasons] = useState<Record<string, string>>({});
  if (history && onBackToCurrent && onRetryHistory) return <ContextHistoryPanel history={history} onBack={onBackToCurrent} onRetry={onRetryHistory} onClose={onClose}/>;
  const selected = preview?.items ?? [];
  const recommendations = preview?.recommendations ?? [];
  const budget = preview?.budget ?? 32_000;
  const tokens = preview?.usedTokens ?? 0;
  const usedSources = new Set(items.map(item => `${item.sourceType}:${item.sourceId}`));
  const candidates = [
    ...nodes.filter(node => node.status !== 'archived' && !usedSources.has(`node:${node.id}`)).map(node => ({ type: 'node' as const, id: node.id, title: node.title })),
    ...segments.filter(segment => segment.status !== 'archived' && nodes.some(node => node.id === segment.nodeId && node.status !== 'archived') && !usedSources.has(`segment:${segment.id}`)).map(segment => ({ type: 'segment' as const, id: segment.id, title: segment.title })),
    ...attachments.filter(file => file.kind === 'file' && !usedSources.has(`file:${file.id}`)).map(file => ({ type: 'file' as const, id: file.id, title: file.name })),
  ];
  const icon = (item: { sourceType?: string }) => item.sourceType === 'node' ? <GitBranch size={14}/> : item.sourceType === 'segment' ? <Layers3 size={14}/> : <FileText size={14}/>;
  const modeCopy = { Auto: '自动选取相关来源；显式排除仍生效。', Assisted: '推荐来源需确认后才会发送。', Strict: '仅使用当前讨论和显式选择的来源。' };
  return <aside className="context-panel" aria-label="当前上下文">
    <header className="panel-header"><div><span className="eyebrow">CONTEXT</span><h2>本轮上下文</h2></div>{onClose && <button className="icon-button" aria-label="关闭上下文" onClick={onClose}><X size={18}/></button>}</header>
    <div className="mode-control" aria-label="上下文模式">{(['Auto', 'Assisted', 'Strict'] as const).map(option => <button key={option} aria-pressed={mode === option} className={mode === option ? 'active' : ''} onClick={() => onMode(option)}>{option}</button>)}</div>
    <p className="context-mode-description">{modeCopy[mode]}</p>
    {loading && <p className="context-history-notice" role="status">正在更新本轮预览…</p>}
    {error && <div className="context-history-notice" role="alert">{error}<button onClick={onRefresh}>重新预览</button></div>}
    {preview && !loading && <div className={`budget-card ${preview.overBudget ? 'over-budget' : ''}`}><div className="budget-top"><span>预计上下文</span><strong>{tokens.toLocaleString()} <small>/ {budget.toLocaleString()} tokens</small></strong></div><progress aria-label="本轮上下文预算" value={Math.min(tokens, budget)} max={Math.max(1, budget)}/><p>{preview.overBudget ? '显式选择超过预算，固定内容仍完整保留。' : `${selected.length} 个来源将在发送时固定版本。`}</p></div>}
    <div className="context-tabs" role="tablist" aria-label="上下文来源"><button role="tab" aria-selected={tab === 'active'} onClick={() => setTab('active')}>生效 {selected.length}</button><button role="tab" aria-selected={tab === 'recommended'} onClick={() => setTab('recommended')}>待确认 {recommendations.length}</button></div>
    <div className="context-scroll">
      <section className="context-group" role="tabpanel" aria-label={tab === 'active' ? '生效来源' : '待确认来源'}>
        {(tab === 'active' ? selected : recommendations).map(item => {
          const stored = items.find(source => source.sourceType === item.sourceType && source.sourceId === item.sourceId);
          const identity = `${item.sourceType}:${item.sourceId}:${item.sourceRevision}`;
          const reason = reasons[identity] ?? '';
          return <article className={`context-item ${tab}`} key={identity}>
            <div className="context-item-main"><span className="file-icon">{icon(item)}</span><div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.tokens.toLocaleString()} tokens{item.pinned ? ' · 已固定' : ''}</small></div></div>
            {item.reason && <div className="why"><Sparkles size={12}/><span>{item.reason}</span></div>}
            {tab === 'recommended' ? <><label className="context-decision-reason">确认理由<input aria-label={`确认理由 ${item.title}`} value={reason} maxLength={500} onChange={event => setReasons(current => ({ ...current, [identity]: event.target.value }))} placeholder="说明采用或排除的原因"/></label><div className="context-actions">{(['accept', 'reject'] as const).map(decision => <button key={decision} disabled={loading || deciding || !reason.trim() || !item.sourceRevision || !item.sourceId || !item.sourceType || !onDecision} onClick={() => { if (item.sourceType && item.sourceId && item.sourceRevision) void onDecision?.({ sourceType: item.sourceType, sourceId: item.sourceId, sourceRevision: item.sourceRevision, decision, reason: reason.trim() }); }}>{decision === 'accept' ? <Check size={13}/> : <EyeOff size={13}/>} {decision === 'accept' ? '加入本轮' : '排除'}</button>)}</div></> : stored && <div className="context-actions"><button disabled={loading || deciding} onClick={() => onPin(stored.id, !stored.pinned)}>{stored.pinned ? <PinOff size={13}/> : <LockKeyhole size={13}/>} {stored.pinned ? '取消固定' : '固定'}</button><button disabled={loading || deciding} onClick={() => onStatus(stored.id, 'excluded')}><EyeOff size={13}/>排除</button></div>}
          </article>;
        })}
        {!loading && preview && !(tab === 'active' ? selected : recommendations).length && <p className="context-empty">{tab === 'active' ? '本轮没有额外来源。' : '没有待确认的推荐。'}</p>}
      </section>
      <details className="context-source-picker"><summary><Plus size={13}/>手动添加来源</summary><div>{candidates.length ? candidates.map(source => <button key={`${source.type}:${source.id}`} onClick={() => onAddSource(source.type, source.id)}>{source.type === 'node' ? <GitBranch size={13}/> : source.type === 'segment' ? <Layers3 size={13}/> : <FileText size={13}/>}<span>{source.title}</span><Plus size={12}/></button>) : <p>所有可用来源均已选择。</p>}</div></details>
      <details className="context-omissions"><summary>未采用的来源 · {preview?.omissions.length ?? 0}</summary>{preview?.omissions.map((item, index) => <article className="context-item excluded" key={`${item.sourceType}:${item.sourceId}:${index}`}><strong>{item.title}</strong><p>{item.reason}</p></article>)}{items.filter(item => item.status === 'excluded').map(item => <article className="context-item excluded" key={item.id}><strong>{item.title}</strong><div className="context-actions"><button onClick={() => onStatus(item.id, 'active')}><Plus size={13}/>恢复选择</button></div></article>)}</details>
    </div>
  </aside>;
}
