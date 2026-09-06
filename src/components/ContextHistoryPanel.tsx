import { ArrowLeft, Check, EyeOff } from 'lucide-react';
import type { ContextHistory } from '../types';

export interface ContextHistoryState { messageId: string; loading: boolean; data?: ContextHistory; error?: string }
const missingLabels = { missing_resource: '来源记录缺失', missing_version: '来源版本缺失', missing_blob: '冻结内容缺失', digest_mismatch: '内容校验失败', legacy_unversioned: '旧记录未保存来源版本' };
const modes = { CURRENT: '当前讨论', USER_SELECTED: '手动选择', AI_RECOMMENDED_ACCEPTED: '已接受推荐', AUTO_RETRIEVED: '自动检索' };

export function ContextHistoryPanel({ history, onBack, onRetry }: { history: ContextHistoryState; onBack: () => void; onRetry: () => void }) {
  const manifest = history.data?.manifest;
  const budget = manifest?.planner?.budget;
  return <aside className="context-panel context-history" aria-label="历史上下文">
    <header className="panel-header"><div><span className="eyebrow">CONTEXT HISTORY</span><h2>当时的上下文</h2><p>查看这一轮使用的冻结证据。</p></div><button className="icon-button" onClick={onBack} aria-label="返回当前上下文"><ArrowLeft size={18}/></button></header>
    {history.loading && <p className="context-history-notice" role="status">正在读取历史上下文…</p>}
    {history.error && <div className="context-history-notice" role="alert"><p>{history.error}</p><button onClick={onRetry}>重新加载</button></div>}
    {manifest && <div className="context-scroll">
      <div className="context-history-meta"><strong>{manifest.mode} · {manifest.provider} / {manifest.model}</strong><time>{new Date(manifest.createdAt).toLocaleString()}</time></div>
      <div className={`budget-card ${budget !== undefined && manifest.estimatedTokens > budget ? 'over-budget' : ''}`}>
        <div className="budget-top"><span>当时的预算占用</span><strong>{manifest.estimatedTokens.toLocaleString()} <small>/ {budget?.toLocaleString() ?? '未记录'} tk</small></strong></div>
        {budget !== undefined && <progress aria-label="历史上下文预算占用" value={Math.min(manifest.estimatedTokens, budget)} max={Math.max(1, budget)}/>}
        <p>{manifest.contextItems.length} 个来源已冻结。{budget !== undefined && manifest.estimatedTokens > budget ? '显式选择超过预算，内容仍完整保留。' : '按当时的选择顺序发送。'}</p>
      </div>
      <section className="context-group"><div className="context-title"><span><Check size={13}/> 为什么使用</span><small>{manifest.contextItems.length}</small></div>
        {manifest.contextItems.length === 0 && <p>这一轮没有选择上下文来源。</p>}
        {manifest.contextItems.map((item, index) => {
          const resolution = history.data?.sources[index];
          return <article className="context-item active" key={`${item.sourceType}:${item.sourceId}:${index}`}>
            <h3><span className="context-priority" aria-label={`优先级 ${(item.priority ?? index) + 1}`}>{(item.priority ?? index) + 1}</span>{item.title}</h3>
            <div className="context-history-tags"><span>{modes[item.selectionMode]}</span><span>{item.tokenCount.toLocaleString()} tk</span>{item.pinned && <span>已固定</span>}</div>
            <p className="context-decision">{item.reason}</p>
            {resolution?.status === 'resolved' ? <details><summary>查看冻结内容 · v{resolution.resourceVersion.version}</summary><pre className="context-frozen-text">{resolution.content || '（空内容）'}</pre></details> : <p className="context-source-missing" role="status">{resolution ? missingLabels[resolution.status] : '来源解析结果缺失'}。保留原选择记录。</p>}
            <details className="context-version"><summary>来源版本与校验信息</summary><dl><dt>来源类型</dt><dd>{item.sourceType}</dd><dt>来源 ID</dt><dd>{item.sourceId}</dd><dt>ResourceVersion</dt><dd>{item.resourceVersionId || '未记录'}</dd><dt>SHA-256</dt><dd>{item.digest || '未记录'}</dd>{item.originResourceVersionId && <><dt>原始文件版本</dt><dd>{item.originResourceVersionId}</dd></>}</dl></details>
          </article>;
        })}
      </section>
      <section className="context-group"><div className="context-title"><span><EyeOff size={13}/> 为什么未使用</span><small>{manifest.omissions?.length ?? manifest.excludedItemIds.length}</small></div>
        {manifest.omissions?.map((item, index) => <article className="context-item excluded" key={`${item.sourceType}:${item.sourceId}:${index}`}><h3>{item.title}</h3><p className="context-decision">{item.reason}</p><small>{item.tokenCount.toLocaleString()} tk</small></article>)}
        {!manifest.omissions?.length && <p>{manifest.excludedItemIds.length ? `旧记录只保存了 ${manifest.excludedItemIds.length} 项排除标识，未记录详细原因。` : '没有记录未采用的候选来源。'}</p>}
      </section>
      <details className="context-runtime-details"><summary>规划与冻结记录</summary><dl><dt>Planner</dt><dd>{manifest.versions?.planner || '未记录'}</dd><dt>Compiler</dt><dd>{manifest.versions?.compiler || '未记录'}</dd><dt>缓存结果</dt><dd>{manifest.cache?.reason || '未记录'}</dd><dt>Manifest</dt><dd>{manifest.id}</dd></dl></details>
    </div>}
  </aside>;
}
