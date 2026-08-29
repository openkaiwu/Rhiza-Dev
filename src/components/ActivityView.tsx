import { History, RefreshCw } from 'lucide-react';
import type { WorkspaceActivityItem } from '../types';

export function ActivityView({ activity, loading, error, onRefresh }: { activity: WorkspaceActivityItem[]; loading: boolean; error?: string; onRefresh: () => void }) {
  return <main id="workspace-main" className="activity-view">
    <header className="workspace-header">
      <div><div className="crumbs">WORKSPACE / DOMAIN JOURNAL</div><h1>活动时间线</h1><p>只显示已提交的语义事实，不混入 token、流式片段或文件读取噪声。</p></div>
      <button className="ghost-button" onClick={onRefresh} disabled={loading}><RefreshCw size={14}/>刷新</button>
    </header>
    {error && <p className="activity-error" role="alert">{error}</p>}
    <ol className="activity-timeline" aria-busy={loading}>
      {!loading && activity.length === 0 && <li className="activity-empty"><History size={18}/><strong>尚无活动事实</strong><span>完成一次 Workspace 变更后，这里会出现可排序的记录。</span></li>}
      {activity.map(item => <li key={item.id}>
        <span className="activity-sequence">#{item.sequence}</span>
        <div><strong>{item.title}</strong><p>{item.detail}</p><code>{item.type}</code></div>
        <time dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString('zh-CN')}</time>
      </li>)}
    </ol>
  </main>;
}
