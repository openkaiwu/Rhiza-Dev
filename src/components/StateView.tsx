import { ArrowUpRight } from 'lucide-react';
import type { ContextItem } from '../types';
const groups = { Fact: '事实来源', Constraint: '约束来源', Decision: '决策来源', Reference: '参考材料' };
export function StateView({ items, onSource }: { items: ContextItem[]; onSource: (item: ContextItem) => void }) {
  const selected = items.filter(item => item.status === 'active');
  return <main id="workspace-main" tabIndex={-1} className="workspace state-view"><header className="workspace-header"><div><h1>知识来源</h1><p>当前执行讨论已选入 Context 的材料。角色表示来源分类，内容仍以原始证据为准。</p></div></header>
    <div className="state-summary"><div><strong>{selected.length}</strong><span>当前已选来源</span></div><div><strong>{items.filter(item => item.status === 'recommended').length}</strong><span>待确认推荐</span></div></div>
    {!selected.length && <p>当前没有已选知识来源。可在上下文中选择已有讨论、片段或附件。</p>}
    <div className="state-grid">{Object.entries(groups).map(([role, title]) => <section className={`state-card ${role.toLowerCase()}`} key={role}><header><strong>{title}</strong><small>{selected.filter(item => item.role === role).length}</small></header>{selected.filter(item => item.role === role).map(item => <article key={item.id}><div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.sourceType ?? '未记录类型'} · {item.selectionMode ?? '既有选择'}</small></div><button disabled={!item.sourceId} aria-label={`查看来源 ${item.title}`} onClick={() => onSource(item)}><ArrowUpRight size={15}/></button></article>)}</section>)}</div>
  </main>;
}
