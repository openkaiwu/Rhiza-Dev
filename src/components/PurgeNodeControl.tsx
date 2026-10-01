import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function PurgeNodeControl({ nodeId, title, onPurge }: {
  nodeId: string; title: string; onPurge: (id: string, confirmation: string, reason: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const expected = `PURGE ${nodeId}`;
  const valid = confirmation === expected && reason.trim().length > 0;
  const purge = async () => {
    if (!valid || running.current) return;
    running.current = true; setBusy(true); setError('');
    try { await onPurge(nodeId, confirmation, reason.trim()); setOpen(false); }
    catch (error) { setError(error instanceof Error ? error.message : '清除未完成，请稍后重试。'); }
    finally { running.current = false; setBusy(false); }
  };
  return <>
    <button type="button" onClick={() => { setOpen(true); setConfirmation(''); setReason(''); setError(''); }}>永久清除</button>
    {open && createPortal(<div className="dialog-backdrop"><section className="graph-dialog" role="alertdialog" aria-modal="true" aria-label="永久清除节点">
      <h2>永久清除「{title}」？</h2>
      <p>清除当前实例中的正文、执行历史和所属附件，无法恢复。已导出的归档及备份需单独处理。</p>
      <p>存在活跃执行或跨节点引用时，系统会拒绝清除。</p>
      <label>确认文本：{expected}<input autoFocus aria-label="清除确认文本" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)}/></label>
      <label>清除原因<input aria-label="清除原因" value={reason} disabled={busy} onChange={event => setReason(event.target.value)}/></label>
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" disabled={busy} onClick={() => setOpen(false)}>取消</button><button type="button" className="primary-button" disabled={!valid || busy} onClick={() => void purge()}>{busy ? '正在清除…' : '确认永久清除'}</button></div>
    </section></div>, document.body)}
  </>;
}
