import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ReplayPolicy, ReplayPreflight } from '../types';

const labels: Record<ReplayPolicy, string> = { exact: 'Exact：保持原运行配置', partial: 'Partial：接受已列出的配置差异', 'current-model': 'Current-model：使用当前模型' };

export function ReplayPanel({ runId, busy, onReplay }: { runId: string; busy: boolean; onReplay: (policy: ReplayPolicy) => void }) {
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [preflight, setPreflight] = useState<ReplayPreflight>();
  const [error, setError] = useState('');
  const [policy, setPolicy] = useState<ReplayPolicy>('exact');
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    if (!open) return;
    let current = true;
    const workspaceId = api.workspaceId();
    setPreflight(undefined); setError(''); setAccepted(false);
    void api.getReplayPreflight(runId).then(result => { if (current && workspaceId === api.workspaceId()) setPreflight(result); }).catch(reason => { if (current && workspaceId === api.workspaceId()) setError(reason instanceof Error ? reason.message : '无法检查历史资源。'); });
    return () => { current = false; };
  }, [open, runId, revision]);
  const selected = preflight?.policies.find(item => item.policy === policy);
  const differences = selected?.differences ?? [];
  const available = Boolean(preflight && !preflight.missingRefs.length && selected?.allowed);
  return <details className="run-replay" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>历史回放</summary>
    <p>先检查冻结资源与配置。回放创建新的执行记录，可能产生模型调用费用。</p>
    {!preflight && !error && open && <p role="status">正在检查历史资源…</p>}
    {error && <p role="alert">{error}</p>}
    {preflight && <>
      {!!preflight.missingRefs.length && <p role="alert">历史资源缺失或损坏，无法回放。不会调用模型或使用当前内容替代。</p>}
      <label>回放策略<select disabled={busy} value={policy} onChange={event => { setPolicy(event.target.value as ReplayPolicy); setAccepted(false); }}>{(Object.keys(labels) as ReplayPolicy[]).map(option => <option key={option} value={option} disabled={!preflight.policies.find(item => item.policy === option)?.allowed || !!preflight.missingRefs.length}>{labels[option]}</option>)}</select></label>
      {!selected?.allowed && !preflight.missingRefs.length && <p role="status">此策略当前不可用{selected?.code ? `（${selected.code}）` : ''}，可查看其他策略。</p>}
      {differences.length > 0 && <><ul className="replay-differences">{differences.map(difference => <li key={difference}>{difference}</li>)}</ul><label className="replay-confirmation"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)}/>我接受以上配置差异</label></>}
    </>}
    <div className="replay-actions"><button disabled={busy} onClick={() => setRevision(value => value + 1)}>重新检查资源</button><button disabled={busy || !available || (differences.length > 0 && !accepted)} onClick={() => onReplay(policy)}>按所选策略回放</button></div>
  </details>;
}
