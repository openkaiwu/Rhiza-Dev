import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ProvenanceLink } from '../types';

export function MessageProvenance({ outputId }: { outputId: string }) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [link, setLink] = useState<ProvenanceLink>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let current = true;
    setLink(undefined); setError('');
    void api.getProvenance(outputId).then(value => { if (current) setLink(value); }).catch(reason => {
      if (current) setError(reason instanceof Error ? reason.message : '无法读取来源。');
    });
    return () => { current = false; };
  }, [open, outputId, attempt]);
  return <div className="message-provenance">
    <button aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? '收起来源' : '查看来源'}</button>
    {open && <section aria-label="消息来源">
      {!link && !error && <p role="status">正在读取来源…</p>}
      {error && <p role="alert">{error} <button onClick={() => setAttempt(value => value + 1)}>重试</button></p>}
      {link && <>
        <p>{link.status === 'recorded' ? '来源已记录' : link.status === 'pre-run' ? '旧记录：没有完整执行快照' : '来源存在缺失引用'}</p>
        {link.missingRefs.length > 0 && <p role="status">缺失：{link.missingRefs.join('、')}</p>}
        <dl>{[
          ['输出', link.outputRef], ['输入', link.inputRefs.join('、') || '未记录'], ['执行 Run', link.runRef],
          ['Context Manifest', link.contextManifestRef], ['模型', link.modelSpecRef], ['端点标识', link.providerEndpointRef],
          ['运行时快照', link.runtimeSnapshotRef], ['父修订', link.parentRevisionRef], ['分支来源', link.branchSourceRef],
        ].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      </>}
    </section>}
  </div>;
}
