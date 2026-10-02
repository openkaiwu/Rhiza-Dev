import type { Attachment, ResourceVersionView } from '../types';

export interface ResourceSourceLink { resourceId: string; versionId: string; title: string; manifestId: string; sourceIndex: number }
export function ResourceView({ attachments, sources, resourceId, versionId, data, loading, error, downloadBusy, downloadError, onVersion, onManifest, onRetry, onDownload }: {
  attachments: Attachment[]; sources: ResourceSourceLink[]; resourceId?: string; versionId?: string;
  data?: ResourceVersionView; loading: boolean; error?: string; downloadBusy: boolean; downloadError?: string;
  onVersion: (resourceId: string, versionId: string) => void; onManifest: (id: string, sourceIndex: number) => void;
  onRetry: () => void; onDownload: () => void;
}) {
  const exact = Boolean(resourceId && versionId);
  const selectedAttachments = attachments.filter(item => !resourceId || item.resourceId === resourceId);
  const selectedSources = sources.filter(item => (!resourceId || item.resourceId === resourceId) && (!versionId || item.versionId === versionId));
  return <main id="workspace-main" tabIndex={-1} className="workspace landing-view resource-view">
    <header className="resource-heading"><div><span className="eyebrow">附件与历史资源</span><h1>{exact ? data?.resource.title || '资源版本' : '附件与历史资源'}</h1><p>{exact ? '查看此版本的已校验内容。' : '选择附件版本，或从回答的冻结来源继续查看。'}</p></div>
      {data && <button className="secondary-button" disabled={downloadBusy} onClick={onDownload}>{downloadBusy ? '正在读取原文…' : '下载此版本原文'}</button>}
    </header>
    {exact && loading && <p role="status" aria-busy="true">正在校验资源版本…</p>}
    {error && <div role="alert" className="resource-notice"><p>{error}</p><button onClick={onRetry}>重新读取资源</button></div>}
    {downloadError && <p role="alert" className="resource-notice">{downloadError}</p>}
    {data && <>
      <div className="resource-summary"><span>v{data.version.version}</span><span>{data.version.mediaType}</span><span>{data.version.size.toLocaleString()} bytes</span><time>{new Date(data.version.createdAt).toLocaleString()}</time></div>
      {data.preview.kind === 'text' ? <section aria-label="此版本原文"><pre className="resource-text">{data.preview.text || '（空内容）'}</pre></section> : <p className="resource-notice">{data.preview.kind === 'too_large' ? '内容超过预览大小，可下载此版本完整原文。' : '此文件不提供文本预览，可下载此版本原文。'}</p>}
      <details className="resource-identity"><summary>版本与校验信息</summary><dl><dt>Resource</dt><dd>{data.resource.id}</dd><dt>ResourceVersion</dt><dd>{data.version.id}</dd><dt>SHA-256</dt><dd>{data.version.digest}</dd><dt>内容规范</dt><dd>{data.version.canonicalization}</dd></dl></details>
    </>}
    {!exact && <section aria-label="附件版本"><h2>附件</h2>{selectedAttachments.length ? selectedAttachments.map(item => <article className="resource-row" key={item.id}><div><strong>{item.name}</strong><p>{item.mimeType} · {item.size.toLocaleString()} bytes</p></div>{item.resourceId && item.resourceVersionId ? <button onClick={() => onVersion(item.resourceId!, item.resourceVersionId!)}>查看附件原文</button> : <span>此旧附件未记录版本身份</span>}</article>) : <p className="resource-notice">没有已记录的附件。历史来源仍可从原回答查看。</p>}</section>}
    <section aria-label="冻结来源"><h2>冻结来源</h2>{selectedSources.length ? selectedSources.map(item => <article className="resource-row" key={`${item.manifestId}:${item.sourceIndex}`}><div><strong>{item.title}</strong><small>{item.versionId}</small></div><div className="resource-row-actions">{!exact && <button onClick={() => onVersion(item.resourceId, item.versionId)}>查看资源原文</button>}<button onClick={() => onManifest(item.manifestId, item.sourceIndex)}>返回冻结上下文</button></div></article>) : <p className="resource-notice">此列表没有记录引用它的 Manifest。</p>}</section>
  </main>;
}
