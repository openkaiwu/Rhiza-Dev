import { useRef, useState } from 'react';
import { api } from '../api';

export function BundleControls({ workspaceId, onImported }: { workspaceId?: string; onImported?: (workspaceId: string) => Promise<void> }) {
  const [selection, setSelection] = useState<{ file: File; key: string }>();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.previewWorkspaceBundle>>>();
  const [message, setMessage] = useState('');
  const running = useRef(false);
  const previewBundle = async () => {
    if (!selection || running.current) return;
    running.current = true; setBusy(true); setPreview(undefined); setMessage('正在预检归档…');
    try {
      setPreview(await api.previewWorkspaceBundle(selection.file));
      setMessage('归档校验通过。请确认内容后导入；目标冲突将在正式导入时检查。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '预检失败，请重试。'); }
    finally { running.current = false; setBusy(false); }
  };
  const importBundle = async () => {
    if (!selection || !preview || running.current) return;
    running.current = true; setBusy(true); setMessage('正在校验并导入，请勿关闭页面。');
    try {
      const result = await api.importWorkspaceBundle(selection.file, selection.key);
      setMessage('导入成功。');
      await onImported?.(result.workspaceId);
    } catch (error) { setMessage(error instanceof Error ? error.message : '导入失败，请重试。'); }
    finally { running.current = false; setBusy(false); }
  };
  return <details className="bundle-controls">
    <summary>导入 / 导出 Workspace</summary>
    <p>归档包含对话与冻结内容，请妥善保管；导出后无法撤回。</p>
    {workspaceId && <a href={`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/bundle`} download="workspace.rhiza">下载 workspace.rhiza</a>}
    <p>导入保留原身份，仅限归档 owner；已有工作区不会覆盖。</p>
    <label>选择 .rhiza 归档<input type="file" accept=".rhiza" disabled={busy} onChange={event => {
      const file = event.target.files?.[0];
      setPreview(undefined);
      setMessage('');
      if (file && (!file.name.toLowerCase().endsWith('.rhiza') || file.size > 2 * 1024 ** 3)) {
        setSelection(undefined); setMessage('请选择不超过 2 GiB 的 .rhiza 文件。'); return;
      }
      setSelection(file ? { file, key: crypto.randomUUID() } : undefined);
    }}/></label>
    {preview && <section aria-label="归档预检结果">
      <p>{preview.name}</p>
      <p>{preview.messages} 条消息 · {preview.runs} 次执行 · {preview.resourceVersions} 个资源版本</p>
      <p>工作区：{preview.workspaceId}</p>
    </section>}
    <button disabled={!selection || busy} onClick={() => void (preview ? importBundle() : previewBundle())}>{busy ? '处理中…' : preview ? '导入所选归档' : '预检所选归档'}</button>
    <p role="status" aria-live="polite">{message}</p>
  </details>;
}
