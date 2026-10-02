import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { ExecutionRun, ReplayPolicy } from '../types';
import { ReplayPanel } from './ReplayPanel';

const active = (run: ExecutionRun) => ['created', 'dispatching', 'running'].includes(run.status);
const labels: Record<string, string> = { created: '已创建', dispatching: '正在派发', running: '生成中', completed: '已完成', failed: '失败', canceled: '已取消', interrupted: '执行中断' };

export function RunHistory({ onChanged, focusedRun, onRefreshFocused, readOnly = false, onInspectContext }: { onChanged: () => void; focusedRun?: ExecutionRun; onRefreshFocused?: () => Promise<void>; readOnly?: boolean; onInspectContext?: (manifestId: string) => void }) {
  const [runs, setRuns] = useState<ExecutionRun[]>([]);
  const [error, setError] = useState('');
  const focusedRunId = focusedRun?.id;
  const displayedRuns = focusedRun && !runs.some(run => run.id === focusedRun.id && run.workspaceId === focusedRun.workspaceId) ? [...runs.filter(run => run.id !== focusedRun.id), focusedRun] : runs;
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
    try { const result = await api.listRuns(); if (live.current && request === sequence.current) { setRuns(result.runs); setError(''); } }
    catch { if (live.current && request === sequence.current) setError('无法加载执行历史，请刷新重试。'); }
    finally { if (live.current && request === sequence.current) await focusedRefresh.current?.(); }
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
    <header className="workspace-header"><div><div className="crumbs">WORKSPACE / EXECUTION RUNS</div><h1>执行历史</h1><p>每次模型调用的状态、输入身份和重试来源。记录每两秒刷新。</p></div><button className="ghost-button" onClick={() => void refresh()}>刷新</button></header>
    {error && <p role="alert">{error}</p>}
    {replayNotice && <p role="status" aria-live="polite">{replayNotice}</p>}
    <ol className="activity-timeline">{displayedRuns.length === 0 && <li>尚无执行记录</li>}{displayedRuns.map(run => <li key={run.id} id={`run-${run.id}`} className={focusedRunId === run.id ? 'focused-run' : undefined}>
      <article><strong>{labels[run.status] ?? run.status} · {run.input.executor.model}</strong><p>{run.input.executor.provider} · {new Date(run.createdAt).toLocaleString()}</p>
        {run.error && <p role="status">{run.error.message} ({run.error.class} / {run.error.code})</p>}
        <details><summary>执行详情</summary><dl><dt>Run</dt><dd>{run.id}</dd><dt>输入 SHA-256</dt><dd>{run.inputHash}</dd><dt>模型 / Endpoint</dt><dd>{run.input.executor.modelSpecRef} / {run.input.executor.providerEndpointRef}</dd><dt>重试来源</dt><dd>{run.parentRunRef ?? '首次执行'}</dd><dt>耗时 / 首 token</dt><dd>{run.telemetry.durationMs ?? '—'} ms / {run.telemetry.ttftMs ?? '—'} ms</dd><dt>Token / Trace</dt><dd>{run.telemetry.usage?.totalTokens ?? '—'} / {run.telemetry.traceCount}</dd></dl><p>{run.input.request.prompt}</p></details>
        {active(run) ? <button disabled={readOnly || busy} onClick={() => void act(run, false)}>停止</button> : ['failed','canceled','interrupted'].includes(run.status) && !run.nodeId.startsWith('temp:') && <button disabled={readOnly || busy} onClick={() => void act(run, true)}>重试为新 Run</button>}
        {run.input.request.manifestId && onInspectContext && <button onClick={() => onInspectContext(run.input.request.manifestId!)}>查看历史上下文</button>}
        {!active(run) && !run.nodeId.startsWith('temp:') && <ReplayPanel runId={run.id} busy={readOnly || busy} onReplay={policy => void replay(run, policy)}/>}

      </article>
    </li>)}</ol>
  </main>;
}
