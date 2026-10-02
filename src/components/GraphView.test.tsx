import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GraphView } from './GraphView';
import type { GraphBatchResult } from '../types';

const node = { id: 'root', title: '根节点', summary: '根讨论', status: 'active' as const, kind: 'main' as const, x: 320, y: 160, createdAt: '', updatedAt: '' };
const callbacks = () => ({ onMove: vi.fn().mockResolvedValue(undefined), onActivate: vi.fn().mockResolvedValue(undefined), onCreateNode: vi.fn().mockResolvedValue(undefined), onArchiveNode: vi.fn().mockResolvedValue(undefined), onRestoreNode: vi.fn().mockResolvedValue(undefined), onCreateEdge: vi.fn().mockResolvedValue(undefined), onDeleteEdge: vi.fn().mockResolvedValue(undefined) });

describe('GraphView', () => {
  it('zooms the graph and creates a node from the graph toolbar', async () => {
    const handlers = callbacks();
    render(<GraphView nodes={[node]} edges={[]} activeNodeId="root" {...handlers} />);
    fireEvent.click(screen.getByRole('button', { name: '放大图谱' }));
    expect(screen.getByLabelText('当前缩放比例')).toHaveTextContent('90%');
    fireEvent.click(screen.getByRole('button', { name: '新建图谱节点' }));
    fireEvent.change(screen.getByLabelText('节点标题'), { target: { value: '新节点' } });
    fireEvent.change(screen.getByLabelText('摘要（可选）'), { target: { value: '节点摘要' } });
    fireEvent.click(screen.getByRole('button', { name: '创建节点' }));
    await waitFor(() => expect(handlers.onCreateNode).toHaveBeenCalledWith(expect.objectContaining({ title: '新节点', summary: '节点摘要' })));
  });

  it('confirms archiving without presenting it as deletion', async () => {
    const handlers = callbacks();
    render(<GraphView nodes={[node]} edges={[]} activeNodeId="root" {...handlers} />);
    fireEvent.click(screen.getByRole('button', { name: '归档节点 根节点' }));
    expect(screen.getByRole('alertdialog', { name: '归档图谱节点' })).toHaveTextContent('消息和关系会保留');
    fireEvent.click(screen.getByRole('button', { name: '确认归档' }));
    await waitFor(() => expect(handlers.onArchiveNode).toHaveBeenCalledWith('root'));
  });

  it('hides archived nodes from the canvas, search and overview while exposing restore', async () => {
    const archived = { ...node, id: 'archived', title: '已归档讨论', status: 'archived' as const };
    const handlers = callbacks();
    render(<GraphView nodes={[node, archived]} edges={[]} activeNodeId="root" {...handlers} />);
    expect(screen.getByRole('button', { name: '讨论节点：根节点' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '讨论节点：已归档讨论' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('图谱概览').querySelectorAll('i')).toHaveLength(1);
    expect(screen.getByRole('region', { name: '已归档节点' })).toHaveTextContent('已归档讨论');
    fireEvent.click(screen.getByRole('button', { name: '恢复' }));
    await waitFor(() => expect(handlers.onRestoreNode).toHaveBeenCalledWith('archived'));
  });

  it('rolls back a failed drag and keeps relation deletion available', async () => {
    const handlers = callbacks();
    handlers.onMove.mockRejectedValueOnce(new Error('save failed'));
    const target = { ...node, id: 'target', title: '目标节点', x: 550 };
    render(<GraphView nodes={[node, target]} edges={[{ id: 'relation', source: node.id, target: target.id, relation: 'related-to', label: '测试关系' }]} activeNodeId="root" {...handlers} />);
    const element = screen.getByRole('button', { name: '讨论节点：根节点' });
    element.setPointerCapture = vi.fn(); element.hasPointerCapture = () => false;
    const pointer = (type: string, x: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 200 });
      Object.defineProperty(event, 'movementX', { value: 30 });
      Object.defineProperty(event, 'movementY', { value: 0 });
      fireEvent(element, event);
    };
    pointer('pointerdown', 350); pointer('pointermove', 380); pointer('pointerup', 380);
    await waitFor(() => expect(handlers.onMove).toHaveBeenCalled());
    await waitFor(() => expect(element.style.left).toBe('320px'));
    expect(screen.getByRole('alert')).toHaveTextContent('无法保存节点位置');
    fireEvent.click(screen.getByText('测试关系'));
    fireEvent.click(screen.getByRole('button', { name: '删除选中关系' }));
    await waitFor(() => expect(handlers.onDeleteEdge).toHaveBeenCalledWith('relation'));
  });

  it('keeps 300 nodes navigable while culling offscreen DOM', async () => {
    vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({left:0,top:0,width:800,height:600,right:800,bottom:600,x:0,y:0,toJSON:()=>({})});
    const nodes = Array.from({ length: 300 }, (_, index) => ({ ...node, id: `node-${index}`, title: `讨论 ${index}`, summary: index === 287 ? '唯一检索目标' : '规模测试', x: (index % 20) * 100, y: Math.floor(index / 20) * 80 }));
    render(<GraphView nodes={nodes} edges={[]} activeNodeId="node-287" {...callbacks()} />);
    await waitFor(()=>expect(document.querySelector('[aria-label="讨论节点：讨论 287"]')).toBeInTheDocument());
    expect(document.querySelectorAll('.graph-node').length).toBeLessThan(300);
    expect(document.querySelector('[aria-label="讨论节点：讨论 287"]')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索图谱'), { target: { value: '唯一检索目标' } });
    expect(document.querySelectorAll('.graph-node')).toHaveLength(1);
    fireEvent.keyDown(screen.getByLabelText('搜索图谱'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: '适合全部节点' }));
    expect(screen.getByLabelText('图谱概览').querySelectorAll('i')).toHaveLength(300);
    vi.restoreAllMocks();
  });
});

it('filters status/relation/time, highlights a path and connects accessible Context actions',async()=>{
 const target={...node,id:'target',title:'目标',status:'resolved' as const,x:520,updatedAt:'2026-09-30T12:00:00Z'};
 const onFilter=vi.fn(),onPath=vi.fn().mockResolvedValue(['root','target']),onContext=vi.fn().mockResolvedValue(undefined);
 const props={nodes:[{...node,objectType:'conversation' as const,updatedAt:'2026-09-01T12:00:00Z'},target],edges:[{id:'edge',source:'root',target:'target',relation:'related-to' as const,label:'关联'}],activeNodeId:'root',...callbacks(),onFilter,onPath,onContext};
 const view=render(<GraphView {...props}/>);
 fireEvent.change(screen.getByLabelText('路径目标'),{target:{value:'target'}});fireEvent.click(screen.getByRole('button',{name:'高亮路径'}));await waitFor(()=>expect(document.querySelectorAll('.path-highlight')).toHaveLength(2));expect(onPath).toHaveBeenCalledWith('root','target');
 fireEvent.change(screen.getByLabelText('关系'),{target:{value:'references'}});expect(screen.queryByText('关联')).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('状态'),{target:{value:'resolved'}});fireEvent.change(screen.getByLabelText('更新时间之后'),{target:{value:'2026-09-20'}});await waitFor(()=>expect(onFilter).toHaveBeenLastCalledWith(expect.objectContaining({statuses:['resolved'],updatedAfter:new Date('2026-09-20').toISOString()})));expect(screen.queryByRole('button',{name:'讨论节点：根节点'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByText('图谱节点列表（键盘导航）'));fireEvent.click(await screen.findByRole('button',{name:'加入 Context'}));expect(onContext).toHaveBeenCalledWith(expect.objectContaining({id:'target'}),false);
 view.rerender(<GraphView {...props} contextIds={['target']}/>);fireEvent.click(screen.getByRole('button',{name:'移出 Context'}));expect(onContext).toHaveBeenLastCalledWith(expect.objectContaining({id:'target'}),true);
});

it('requires explicit archive confirmation, sends ordered selected nodes and exposes partial resume and guarded Undo', async () => {
  const target = { ...node, id: 'target', title: '目标节点', x: 550 }; const batchAction = vi.fn().mockResolvedValue(undefined); const undo = vi.fn(); const resume = vi.fn();
  const props = { nodes: [node, target], edges: [], activeNodeId: 'root', ...callbacks(), onBatch: batchAction, onUndoBatch: undo, onResumeBatch: resume };
  const view = render(<GraphView {...props}/>);
  fireEvent.click(screen.getByRole('button', { name: '批量选择' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: '选择讨论 根节点' })); fireEvent.click(screen.getByRole('checkbox', { name: '选择讨论 目标节点' }));
  expect(screen.getByRole('button', { name: '归档所选讨论' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: '确认归档所选讨论（可撤销，消息与关系保留）' })); fireEvent.click(screen.getByRole('button', { name: '归档所选讨论' }));
  expect(batchAction).toHaveBeenCalledWith(['root', 'target'], 'archive');
  fireEvent.click(screen.getByRole('button', { name: '连接所选讨论' })); expect(batchAction).toHaveBeenCalledWith(['root', 'target'], 'relate', 'related-to');
  const batch: GraphBatchResult = { batchId: 'batch', workspaceId: 'workspace', status: 'partial', outcomes: [{ itemId: 'root', status: 'succeeded', undoable: true }, { itemId: 'target', status: 'failed', code: 'OBJECT_CHANGED', undoable: false }] };
  view.rerender(<GraphView {...props} batch={batch}/>); fireEvent.click(screen.getByRole('button', { name: '继续原批次' })); expect(resume).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '撤销已完成项' })); expect(undo).toHaveBeenCalledOnce();
});

it('restores personal positions/zoom and saves collapse/filter state through the presentation callback', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const personal = { positions: { root: { x: 730, y: 410 } }, viewport: { x: -400, y: -200, scale: 1.1 }, collapsedIds: ['root'], relationFilter: 'references' as const };
  render(<GraphView nodes={[node]} edges={[]} activeNodeId="root" {...callbacks()} personalView={personal} onSavePersonal={save}/>);
  expect(screen.getByRole('button', { name: '讨论节点：根节点' }).style.left).toBe('730px'); expect(screen.getByLabelText('当前缩放比例')).toHaveTextContent('110%');
  fireEvent.click(screen.getByRole('button', { name: '保存个人视图' })); await screen.findByText('个人视图已保存。');
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ positions: personal.positions, viewport: personal.viewport, collapsedIds: ['root'], relationFilter: 'references' }));
});
