import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { ExecutionRun } from '../types';

const active = (run: ExecutionRun) => ['created', 'dispatching', 'running'].includes(run.status);
const labels: Record<string, string> = { created: '已创建', dispatching: '正在派发', running: '生成中', completed: '已完成', failed: '失败', canceled: '已取消', interrupted: '执行中断' };

export function RunHistory({ onChanged }: { onChanged: () => void }) {
  const [runs, setRuns] = useState<ExecutionRun[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    try {
      if (retry) {
        await api.activateNode(run.nodeId);
        if (!live.current) return;
        await api.streamMessage(run.input.request.prompt, () => undefined, { operation: 'retry', parentRunRef: run.id, attachmentIds: run.input.request.attachments?.map(item => item.id), generation: run.input.request.generation });
      } else await api.cancelRun(run.id);
      if (live.current) { await refresh(); onChanged(); }
    } catch { if (live.current) { await refresh(); setError('操作未完成，请查看执行状态后重试。'); } }
    finally { if (live.current) setBusy(false); }
  };
  return <main id="workspace-main" className="activity-view run-history">
    <header className="workspace-header"><div><div className="crumbs">WORKSPACE / EXECUTION RUNS</div><h1>执行历史</h1><p>每次模型调用的状态、输入身份和重试来源。记录每两秒刷新。</p></div><button className="ghost-button" onClick={() => void refresh()}>刷新</button></header>
    {error && <p role="alert">{error}</p>}
    <ol className="activity-timeline">{runs.length === 0 && <li>尚无执行记录</li>}{runs.map(run => <li key={run.id}>
      <article><strong>{labels[run.status] ?? run.status} · {run.input.executor.model}</strong><p>{run.input.executor.provider} · {new Date(run.createdAt).toLocaleString()}</p>
        {run.error && <p role="status">{run.error.message} ({run.error.class} / {run.error.code})</p>}
        <details><summary>执行详情</summary><dl><dt>Run</dt><dd>{run.id}</dd><dt>输入 SHA-256</dt><dd>{run.inputHash}</dd><dt>模型 / Endpoint</dt><dd>{run.input.executor.modelSpecRef} / {run.input.executor.providerEndpointRef}</dd><dt>重试来源</dt><dd>{run.parentRunRef ?? '首次执行'}</dd><dt>耗时 / 首 token</dt><dd>{run.telemetry.durationMs ?? '—'} ms / {run.telemetry.ttftMs ?? '—'} ms</dd><dt>Token / Trace</dt><dd>{run.telemetry.usage?.totalTokens ?? '—'} / {run.telemetry.traceCount}</dd></dl><p>{run.input.request.prompt}</p></details>
        {active(run) ? <button disabled={busy} onClick={() => void act(run, false)}>停止</button> : !run.nodeId.startsWith('temp:') && <button disabled={busy} onClick={() => void act(run, true)}>重试为新 Run</button>}
      </article>
    </li>)}</ol>
  </main>;
}
