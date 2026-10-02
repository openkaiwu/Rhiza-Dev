import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { ExecutionRun } from '../types';

const active = (run: ExecutionRun) => ['created', 'dispatching', 'running'].includes(run.status);
const labels: Record<string, string> = { created: '已创建', dispatching: '正在派发', running: '生成中', completed: '已完成', failed: '失败', canceled: '已取消', interrupted: '执行中断' };
type ReplayPolicy = 'exact' | 'partial' | 'current-model';

export function RunHistory({ onChanged }: { onChanged: () => void }) {
  const [runs, setRuns] = useState<ExecutionRun[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [policies, setPolicies] = useState<Record<string, ReplayPolicy>>({});
  const [replayNotice, setReplayNotice] = useState('');
  const action = useRef(false);
  const replayKeys = useRef(new Map<string, string>());
  const live = useRef(true);
  const sequence = useRef(0);
  const refresh = async () => {
    const request = ++sequence.current;
    try { const result = await api.listRuns(); if (live.current && request === sequence.current) { setRuns(result.runs); setError(''); } }
    catch { if (live.current && request === sequence.current) setError('无法加载执行历史，请刷新重试。'); }
  };
  useEffect(() => {
    live.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => { live.current = false; sequence.current += 1; clearInterval(timer); };
  }, []);
  const act = async (run: ExecutionRun, retry: boolean) => {
    if (action.current) return;
    action.current = true;
    setBusy(true);
    try {
      if (retry) {
        await api.activateNode(run.nodeId);
        if (!live.current) return;
        await api.retryRun(run.id,crypto.randomUUID());
      } else await api.cancelRun(run.id);
      if (live.current) { await refresh(); if (live.current) onChanged(); }
    } catch { if (live.current) { await refresh(); setError('操作未完成，请查看执行状态后重试。'); } }
    finally { action.current = false; if (live.current) setBusy(false); }
  };
  const replay = async (run: ExecutionRun) => {
    if (action.current) return;
    action.current = true; setBusy(true); setReplayNotice('正在按所选策略创建回放 Run…');
    const policy = policies[run.id] ?? 'exact';
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
    <ol className="activity-timeline">{runs.length === 0 && <li>尚无执行记录</li>}{runs.map(run => <li key={run.id}>
      <article><strong>{labels[run.status] ?? run.status} · {run.input.executor.model}</strong><p>{run.input.executor.provider} · {new Date(run.createdAt).toLocaleString()}</p>
        {run.error && <p role="status">{run.error.message} ({run.error.class} / {run.error.code})</p>}
        <details><summary>执行详情</summary><dl><dt>Run</dt><dd>{run.id}</dd><dt>输入 SHA-256</dt><dd>{run.inputHash}</dd><dt>模型 / Endpoint</dt><dd>{run.input.executor.modelSpecRef} / {run.input.executor.providerEndpointRef}</dd><dt>重试来源</dt><dd>{run.parentRunRef ?? '首次执行'}</dd><dt>耗时 / 首 token</dt><dd>{run.telemetry.durationMs ?? '—'} ms / {run.telemetry.ttftMs ?? '—'} ms</dd><dt>Token / Trace</dt><dd>{run.telemetry.usage?.totalTokens ?? '—'} / {run.telemetry.traceCount}</dd></dl><p>{run.input.request.prompt}</p></details>
        {active(run) ? <button disabled={busy} onClick={() => void act(run, false)}>停止</button> : ['failed','canceled','interrupted'].includes(run.status) && !run.nodeId.startsWith('temp:') && <button disabled={busy} onClick={() => void act(run, true)}>重试为新 Run</button>}
        {!active(run) && !run.nodeId.startsWith('temp:') && <details className="run-replay"><summary>历史回放</summary>
          <p>创建新 Run，可能产生模型调用费用。历史资源缺失时拒绝执行，不会自动更换版本。</p>
          <label>回放策略<select disabled={busy} value={policies[run.id] ?? 'exact'} onChange={event => setPolicies(current => ({ ...current, [run.id]: event.target.value as ReplayPolicy }))}>
            <option value="exact">Exact：保持原运行配置</option><option value="partial">Partial：明确接受配置差异</option><option value="current-model">Current-model：使用当前模型</option>
          </select></label>
          <button disabled={busy} onClick={() => void replay(run)}>按所选策略回放</button>
        </details>}
      </article>
    </li>)}</ol>
  </main>;
}
