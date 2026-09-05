import { Check, ChevronDown, EyeOff, FileText, GitBranch, Layers3, LockKeyhole, MoreHorizontal, PinOff, Plus, Sparkles, X } from 'lucide-react';
import type { Attachment, ContextItem, ContextMode, ContextStatus, DiscussionNode, Segment } from '../types';
import { ContextHistoryPanel, type ContextHistoryState } from './ContextHistoryPanel';

const sectionTitle: Record<ContextStatus, string> = { active: 'Active · 本轮生效', recommended: 'Recommended · 待确认', excluded: 'Excluded · 已排除' };
const budget = 32_000;

interface ContextPanelProps {
  history?: ContextHistoryState;
  onBackToCurrent?: () => void;
  onRetryHistory?: () => void;
  items: ContextItem[];
  mode: ContextMode;
  nodes: DiscussionNode[];
  segments: Segment[];
  attachments: Attachment[];
  onMode: (mode: ContextMode) => void | Promise<void>;
  onStatus: (id: string, status: ContextStatus) => void | Promise<void>;
  onPin: (id: string, pinned: boolean) => void | Promise<void>;
  onAddSource: (sourceType: 'node' | 'segment' | 'file', sourceId: string) => void | Promise<void>;
}

export function ContextPanel({ items, mode, nodes, segments, attachments, onMode, onStatus, onPin, onAddSource, history, onBackToCurrent, onRetryHistory }: ContextPanelProps) {
  if (history && onBackToCurrent && onRetryHistory) return <ContextHistoryPanel history={history} onBack={onBackToCurrent} onRetry={onRetryHistory}/>;
  const activeItems = items.filter(item => item.status === 'active');
  const activeTokens = activeItems.reduce((sum, item) => sum + item.tokens, 0);
  const pinnedTokens = activeItems.filter(item => item.pinned).reduce((sum, item) => sum + item.tokens, 0);
  const usedSources = new Set(items.map(item => `${item.sourceType}:${item.sourceId}`));
  const sourceCandidates = [
    ...nodes.filter(node => !usedSources.has(`node:${node.id}`)).map(node => ({ type: 'node' as const, id: node.id, title: node.title, detail: node.summary })),
    ...segments.filter(segment => !usedSources.has(`segment:${segment.id}`)).map(segment => ({ type: 'segment' as const, id: segment.id, title: segment.title, detail: nodes.find(node => node.id === segment.nodeId)?.title || '未知节点' })),
    ...attachments.filter(file => file.kind === 'file' && !usedSources.has(`file:${file.id}`)).map(file => ({ type: 'file' as const, id: file.id, title: `文件 · ${file.name}`, detail: `${file.chunkCount || 0} chunks · ${file.summary || '已建立本地索引'}` })),
  ];
  const overBudget = activeTokens > budget;

  return (
    <aside className="context-panel">
      <header className="panel-header"><div><span className="eyebrow">CONTEXT INSPECTOR</span><h2>本轮上下文</h2><p>Strict 仅使用显式选择；其他模式按相关性补充。</p></div><button className="icon-button" aria-label="更多上下文操作"><MoreHorizontal size={18}/></button></header>
      <div className="mode-control" aria-label="上下文模式">
        {(['Auto', 'Assisted', 'Strict'] as ContextMode[]).map(option => <button key={option} className={mode === option ? 'active' : ''} onClick={() => onMode(option)}>{option}</button>)}
      </div>
      <div className={`budget-card ${overBudget ? 'over-budget' : ''}`}>
        <div className="budget-top"><span>上下文预算</span><strong>{(activeTokens / 1000).toFixed(1)}K <small>/ 32K</small></strong></div>
        <div className="budget-track"><span style={{ width: `${Math.min(100, Math.max(3, activeTokens / 320))}%` }} /></div>
        <p>{overBudget ? `已超预算；${(pinnedTokens / 1000).toFixed(1)}K Pin 内容仍会完整保留，不会静默丢弃。` : `${activeItems.length} 个来源已选择，将在发送时冻结。`}</p>
      </div>
      <details className="context-source-picker">
        <summary><Plus size={13}/>添加 Node / Segment / File</summary>
        <div>
          {sourceCandidates.length ? sourceCandidates.map(source => <button key={`${source.type}:${source.id}`} onClick={() => onAddSource(source.type, source.id)}>
            {source.type === 'node' ? <GitBranch size={13}/> : source.type === 'segment' ? <Layers3 size={13}/> : <FileText size={13}/>}<span><strong>{source.title}</strong><small>{source.type === 'node' ? 'Node' : source.type === 'segment' ? `Segment · ${source.detail}` : `File · ${source.detail}`}</small></span><Plus size={12}/>
          </button>) : <p>所有可用来源都已在 Inspector 中。</p>}
        </div>
      </details>
      <div className="context-scroll">
        {(['active', 'recommended', 'excluded'] as ContextStatus[]).map(status => {
          const list = items.filter(item => item.status === status);
          return list.length ? <section className="context-group" key={status}>
            <div className="context-title"><span>{status === 'recommended' ? <Sparkles size={13}/> : status === 'excluded' ? <EyeOff size={13}/> : <Check size={13}/>} {sectionTitle[status]}</span><small>{list.length}</small></div>
            {list.map(item => <article className={`context-item ${status} ${item.pinned ? 'pinned' : ''}`} key={item.id}>
              <div className="context-item-main"><span className="file-icon">{item.sourceType === 'node' ? <GitBranch size={14}/> : item.sourceType === 'segment' ? <Layers3 size={14}/> : <FileText size={14}/>}</span><div><strong>{item.title}</strong><p>{item.detail}</p><span className={`role ${item.role.toLowerCase()}`}>{item.role}</span><small>{item.tokens.toLocaleString()} tk</small>{item.selectionMode && <small>{item.selectionMode.replaceAll('_', ' ')}</small>}</div></div>
              {item.reason && <div className="why"><Sparkles size={12}/><span>{item.reason}</span></div>}
              <div className="context-actions">
                {status === 'recommended' && <><button onClick={() => onStatus(item.id, 'active')}><Plus size={13}/>加入</button><button onClick={() => onStatus(item.id, 'excluded')}><EyeOff size={13}/>排除</button></>}
                {status === 'active' && <><button className={item.pinned ? 'active' : ''} aria-label={`${item.pinned ? '取消固定' : '固定'} ${item.title}`} title={item.pinned ? '取消固定' : '固定'} onClick={() => onPin(item.id, !item.pinned)}>{item.pinned ? <PinOff size={13}/> : <LockKeyhole size={13}/>} {item.pinned ? '已固定' : '固定'}</button><button onClick={() => onStatus(item.id, 'recommended')}><X size={13}/>移除</button><button onClick={() => onStatus(item.id, 'excluded')}><EyeOff size={13}/>排除</button></>}
                {status === 'excluded' && <button onClick={() => onStatus(item.id, 'active')}><Plus size={13}/>恢复</button>}
                <button aria-label="更改角色" disabled><ChevronDown size={13}/></button>
              </div>
            </article>)}
          </section> : null;
        })}
      </div>
    </aside>
  );
}
