import { useEffect, useRef, useState } from 'react';
import { Clock3, RefreshCw, Search } from 'lucide-react';
import { api } from '../api';
import type { ExecutionRun, ReplayPolicy } from '../types';
import { ReplayPanel } from './ReplayPanel';

const active = (run: ExecutionRun) => ['created', 'dispatching', 'running'].includes(run.status);
const labels: Record<string, string> = { created: '已创建', dispatching: '正在派发', running: '生成中', completed: '已完成', failed: '失败', canceled: '已取消', interrupted: '执行中断' };

export function RunHistory({ onChanged, focusedRun, onRefreshFocused, readOnly = false, onInspectContext }: { onChanged: () => void; focusedRun?: ExecutionRun; onRefreshFocused?: () => Promise<void>; readOnly?: boolean; onInspectContext?: (manifestId: string) => void }) {
  const [runs, setRuns] = useState<ExecutionRun[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const focusedRunId = focusedRun?.id;
  const displayedRuns = focusedRun && !runs.some(run => run.id === focusedRun.id && run.workspaceId === focusedRun.workspaceId) ? [...runs.filter(run => run.id !== focusedRun.id), focusedRun] : runs;
  const search = query.trim().toLocaleLowerCase();
  const matches = (run: ExecutionRun) => (filter === 'all' || (filter === 'active' ? active(run) : run.status === filter)) && [run.input.executor.model, run.input.executor.provider, run.id, run.input.request.prompt].some(text => text.toLocaleLowerCase().includes(search));
  const matchingRuns = displayedRuns.filter(matches);
  const visibleRuns = displayedRuns.filter(run => matches(run) || run.id === focusedRunId);
  const retainedFocus = visibleRuns.length > matchingRuns.length;
  const filtered = Boolean(search || filter !== 'all');
  const [busy, setBusy] = useState(false);
  const [replayNotice, setReplayNotice] = useState('');
  const action = useRef(false);
  const replayKeys = useRef(new Map<string, string>());
  const retryKeys = useRef(new Map<string,{key:string;parentId:string}>());
  const live = useRef(true);
  const sequence = useRef(0);
  const focusedRefresh = useRef(onRefreshFocused);
  useEffect(() => { focusedRefresh.current = onRefreshFocused; }, [onRefreshFocused]);
  const refresh = async () => {
    const request = ++sequence.current;
    setLoading(true);
    try { const result = await api.listRuns(); if (live.current && request === sequence.current) { setRuns(result.runs); setError(''); } }
    catch { if (live.current && request === sequence.current) setError('无法加载执行历史，请刷新重试。'); }
    finally { if (live.current && request === sequence.current) { setLoading(false); await focusedRefresh.current?.(); } }
  };
  useEffect(() => {
    live.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => { live.current = false; sequence.current += 1; clearInterval(timer); };
  }, []);
  useEffect(() => { if (focusedRunId) document.getElementById(`run-${focusedRunId}`)?.scrollIntoView?.({ block: 'center' }); }, [focusedRunId]);
  const act = async (run: ExecutionRun, retry: boolean) => {
    if (readOnly || action.current) return;
    action.current = true;
    setBusy(true);
    try {
      if (retry) {
        const workspaceId=api.workspaceId();
        let attempt=retryKeys.current.get(run.id);
        if(attempt){
          const previous=await api.findAttemptRun(attempt.key,workspaceId);
          if(!live.current||workspaceId!==api.workspaceId())return;
          if(previous?.status==='completed'){retryKeys.current.delete(run.id);await refresh();if(live.current)onChanged();return;}
          if(previous&&active(previous)){setError('原执行仍在进行，请等待执行状态更新。');return;}
          if(previous)attempt={key:crypto.randomUUID(),parentId:previous.id};
        }
        attempt??={key:crypto.randomUUID(),parentId:run.id};retryKeys.current.set(run.id,attempt);
        await api.activateNode(run.nodeId);
        if (!live.current||workspaceId!==api.workspaceId()) return;
        await api.retryRun(attempt.parentId,attempt.key);
        retryKeys.current.delete(run.id);
      } else await api.cancelRun(run.id);
      if (live.current) { await refresh(); if (live.current) onChanged(); }
    } catch { if (live.current) { await refresh(); setError('操作未完成，请查看执行状态后重试。'); } }
    finally { action.current = false; if (live.current) setBusy(false); }
  };
  const replay = async (run: ExecutionRun, policy: ReplayPolicy) => {
    if (readOnly || action.current) return;
    action.current = true; setBusy(true); setReplayNotice('正在按所选策略创建回放 Run…');
    const identity = `${run.id}:${policy}`;
    const key = replayKeys.current.get(identity) ?? crypto.randomUUID();
    replayKeys.current.set(identity, key);
    try {
      const result = await api.replayRun(run.id, policy, key);
      replayKeys.current.delete(identity);
      if (live.current) { setReplayNotice(`回放已完成：${result.replay.classification}。`); await refresh(); if (live.current) onChanged(); }
    } catch (reason) {
      if (live.current) setReplayNotice(reason instanceof Error ? reason.message : '回放失败，请检查历史资源和模型配置。');
    } finally { action.current = false; if (live.current) setBusy(false); }
  };
  return <main id="workspace-main" className="activity-view run-history">
    <header className="workspace-header"><div><h1>执行历史</h1><p>查看模型调用状态、历史输入与来源，继续处理未完成的执行。</p></div><button className="ghost-button" disabled={loading} onClick={() => void refresh()}><RefreshCw size={14}/>刷新</button></header>
    <div className="record-toolbar">
      <label className="record-search"><Search size={15} aria-hidden="true"/><input type="search" aria-label="搜索执行历史" placeholder="搜索模型、输入或执行记录" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <select aria-label="执行状态" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部状态</option><option value="active">进行中</option>{['completed', 'failed', 'interrupted', 'canceled'].map(status => <option key={status} value={status}>{labels[status]}</option>)}</select>
      <span className="record-count">{filtered ? `匹配 ${matchingRuns.length} / 已加载 ${displayedRuns.length}` : `已加载 ${displayedRuns.length} 次执行`}</span>
      {filtered && <button className="text-button" onClick={() => { setQuery(''); setFilter('all'); }}>清除筛选</button>}
    </div>
    {error && <p className="activity-error" role="alert">{error}</p>}
    {replayNotice && <p className="record-notice" role="status" aria-live="polite">{replayNotice}</p>}
    {retainedFocus && <p className="record-notice">已保留当前定位的执行记录。</p>}
    {loading && !displayedRuns.length && <p className="record-empty" role="status">正在加载执行历史…</p>}
    {!loading && !error && !displayedRuns.length && <div className="record-empty"><Clock3 size={22}/><strong>尚无执行记录</strong><p>发送一次消息后，模型调用和恢复入口会显示在这里。</p></div>}
    {!!displayedRuns.length && !visibleRuns.length && <p className="record-empty" role="status">没有匹配的执行记录</p>}
    {!!visibleRuns.length && <ol className="activity-timeline" aria-busy={loading}>{visibleRuns.map(run => <li key={run.id} id={`run-${run.id}`} className={focusedRunId === run.id ? 'focused-run' : undefined}>
      <article aria-label={`${labels[run.status] ?? run.status} · ${run.input.executor.model}`}>
        <header className="run-row-heading"><h2>{run.input.executor.model}</h2><span className={`run-state run-state-${run.status}`}>{labels[run.status] ?? run.status}</span>{focusedRunId === run.id && <span className="run-focus-label">已定位</span>}<time dateTime={run.createdAt}>{new Date(run.createdAt).toLocaleString('zh-CN')}</time></header>
        <div className="run-row-meta"><span>{run.input.executor.provider}</span>{run.telemetry.durationMs !== undefined && <span>耗时 {(run.telemetry.durationMs / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 秒</span>}{run.telemetry.usage && <span>{run.telemetry.usage.totalTokens.toLocaleString('zh-CN')} tokens</span>}{run.attempt > 1 && <span>第 {run.attempt} 次尝试</span>}</div>
        {run.error && <p className="run-error" role="status">{run.error.message}</p>}
        <details className="record-details"><summary>执行详情</summary><dl><dt>执行记录</dt><dd>{run.id}</dd><dt>输入 SHA-256</dt><dd>{run.inputHash}</dd><dt>模型 / 端点</dt><dd>{run.input.executor.modelSpecRef} / {run.input.executor.providerEndpointRef}</dd><dt>重试来源</dt><dd>{run.parentRunRef ?? '首次执行'}</dd><dt>尝试次数</dt><dd>{run.attempt ?? 1}</dd><dt>耗时 / 首 token</dt><dd>{run.telemetry.durationMs ?? '—'} ms / {run.telemetry.ttftMs ?? '—'} ms</dd><dt>Token / Trace</dt><dd>{run.telemetry.usage?.totalTokens ?? '—'} / {run.telemetry.traceCount}</dd>{run.error && <><dt>错误类型 / 代码</dt><dd>{run.error.class} / {run.error.code}</dd></>}</dl><div className="run-input"><strong>历史输入</strong><p>{run.input.request.prompt}</p></div></details>
        {active(run) ? <button disabled={readOnly || busy} onClick={() => void act(run, false)}>停止</button> : ['failed','canceled','interrupted'].includes(run.status) && !run.nodeId.startsWith('temp:') && <button className="run-retry" disabled={readOnly || busy} onClick={() => void act(run, true)}>重新执行</button>}
        {run.input.request.manifestId && onInspectContext && <button onClick={() => onInspectContext(run.input.request.manifestId!)}>历史上下文</button>}
        {!active(run) && !run.nodeId.startsWith('temp:') && <ReplayPanel runId={run.id} busy={readOnly || busy} onReplay={policy => void replay(run, policy)}/>}

      </article>
    </li>)}</ol>}
  </main>;
}
