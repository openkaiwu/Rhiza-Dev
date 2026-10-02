import type { ContextSelectionPreview } from '../types';

export function GraphContextTray({ preview, busy, readOnly, error, notice, targetTitle, onConfirm, onRefresh, onClose }: {
  preview?: ContextSelectionPreview; busy: boolean; readOnly?: boolean; error?: string; notice?: string; targetTitle: string;
  onConfirm: () => void; onRefresh: () => void; onClose: () => void;
}) {
  return <div className="graph-context-tray-content">
    <header><div><strong>上下文来源</strong><p>用于当前讨论：{targetTitle}</p></div>{preview && <button disabled={busy} onClick={onClose}>取消选择</button>}</header>
    {busy && <p role="status">正在核实来源与预算…</p>}
    {readOnly && <p role="status">工作区已归档，无法修改上下文。</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!preview && !busy && !notice && <p>将所选讨论或片段拖到这里，或使用“审阅所选来源”。审阅后再确认加入。</p>}
    {preview && <>
      <ul>{preview.sources.map(source => <li key={`${source.sourceType}:${source.sourceId}`}><strong>{source.title}</strong><span>{source.sourceType === 'node' ? '讨论' : '片段'} · 版本 {source.sourceRevision.slice(0,8)} · {source.tokens.toLocaleString()} tokens</span></li>)}</ul>
      <p>确认后预算：{preview.usedTokens.toLocaleString()} / {preview.budget.toLocaleString()} tokens</p>
      {preview.sources.some(source=>source.sourceType==='node' && source.sourceId===preview.expectedNodeId) && <p>包含当前讨论的已审阅版本；继续对话使其变化后，需要重新审阅。</p>}
      {preview.overBudget && <p role="alert">所选来源超出预算。请减少选择后重新审阅，当前不会写入。</p>}
      <div className="graph-tray-actions"><button disabled={busy || readOnly} onClick={onRefresh}>重新审阅</button><button disabled={busy || readOnly || preview.overBudget || preview.status !== 'ready'} onClick={onConfirm}>确认加入当前讨论</button></div>
    </>}
  </div>;
}
