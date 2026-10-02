import { useState } from 'react';
import { FileText, History, MessageSquare, PlayCircle, RefreshCw, Search, Settings, Users } from 'lucide-react';
import type { WorkspaceActivityItem } from '../types';

const categories = { conversation: '对话与图谱', run: '模型执行', collaboration: '多模型协作', context: '上下文与资料', workspace: '工作区', other: '其他活动' };
type Category = keyof typeof categories;
const icons = { conversation: MessageSquare, run: PlayCircle, collaboration: Users, context: FileText, workspace: Settings, other: History };
function category(item: WorkspaceActivityItem): Category {
  if (item.type.startsWith('message.') || ['conversation', 'workspace-graph'].includes(item.aggregateType)) return 'conversation';
  if (['context', 'resource'].includes(item.aggregateType)) return 'context';
  if (item.aggregateType === 'run' || item.aggregateType === 'collaboration' || item.aggregateType === 'workspace') return item.aggregateType;
  return 'other';
}
const displayTitle = (title: string) => title.replace(/\s*\bWorkspace\b\s*/g, '工作区').replace(/\s*\bContext\b\s*/g, '上下文').replace(/\s*\bResource\b\s*/g, '资料').replace(/\s*\bSegment\b\s*/g, '分段');

export function ActivityView({ activity, loading, error, onRefresh }: { activity: WorkspaceActivityItem[]; loading: boolean; error?: string; onRefresh: () => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const search = query.trim().toLocaleLowerCase();
  const visible = activity.filter(item => (filter === 'all' || category(item) === filter) && [displayTitle(item.title), item.detail, item.type, item.aggregateId].some(text => text.toLocaleLowerCase().includes(search)));
  const groups: Array<{ date: string; items: WorkspaceActivityItem[] }> = [];
  for (const item of visible) {
    const date = new Date(item.occurredAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
    const previous = groups.at(-1);
    if (previous?.date === date) previous.items.push(item);
    else groups.push({ date, items: [item] });
  }
  const filtered = Boolean(search || filter !== 'all');
  return <main id="workspace-main" className="activity-view journal-view">
    <header className="workspace-header">
      <div><h1>活动时间线</h1><p>回看讨论、执行和资料的变更，沿记录追溯每一步。</p></div>
      <button className="ghost-button" onClick={onRefresh} disabled={loading}><RefreshCw size={14}/>刷新</button>
    </header>
    <div className="record-toolbar">
      <label className="record-search"><Search size={15} aria-hidden="true"/><input type="search" aria-label="搜索活动" placeholder="搜索活动或对象" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <select aria-label="活动类型" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部活动</option>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <span className="record-count">{filtered ? `匹配 ${visible.length} / 已加载 ${activity.length}` : `已加载 ${activity.length} 条活动`}</span>
      {filtered && <button className="text-button" onClick={() => { setQuery(''); setFilter('all'); }}>清除筛选</button>}
    </div>
    {error && <p className="activity-error" role="alert">{error}</p>}
    <div className="activity-groups" aria-busy={loading}>
      {loading && !activity.length && <p className="record-empty" role="status">正在加载活动…</p>}
      {!loading && !error && !activity.length && <div className="record-empty"><History size={22}/><strong>尚无活动记录</strong><p>开始讨论、调整上下文或添加资料后，变更会记录在这里。</p></div>}
      {!!activity.length && !visible.length && <p className="record-empty" role="status">没有匹配的活动</p>}
      {groups.map(group => <section className="activity-date-group" key={group.items[0]!.id}>
        <header><h2>{group.date}</h2><span>{group.items.length} 条活动</span></header>
        <ol className="activity-timeline">{group.items.map(item => {
          const kind = category(item);
          const Icon = icons[kind];
          return <li key={item.id}><article className="activity-event">
            <span className="activity-event-icon" aria-hidden="true"><Icon size={16}/></span>
            <div className="activity-event-main"><h3>{displayTitle(item.title)}</h3><span>{categories[kind]}</span>
              <details className="record-details"><summary>事件详情</summary><dl><dt>事件类型</dt><dd><code>{item.type}</code></dd><dt>对象</dt><dd>{item.aggregateId}</dd><dt>对象类型</dt><dd>{item.aggregateType}</dd><dt>记录</dt><dd>#{item.sequence} · {item.id}</dd><dt>时间</dt><dd>{new Date(item.occurredAt).toLocaleString('zh-CN')}</dd><dt>原始说明</dt><dd>{item.detail}</dd></dl></details>
            </div>
            <time dateTime={item.occurredAt} title={new Date(item.occurredAt).toLocaleString('zh-CN')}>{new Date(item.occurredAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</time>
          </article></li>;
        })}</ol>
      </section>)}
    </div>
  </main>;
}
