import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GraphView } from './GraphView';

const node = { id: 'root', title: '根节点', summary: '根讨论', status: 'active' as const, kind: 'main' as const, x: 320, y: 160, createdAt: '', updatedAt: '' };
const callbacks = () => ({ onMove: vi.fn().mockResolvedValue(undefined), onActivate: vi.fn().mockResolvedValue(undefined), onCreateNode: vi.fn().mockResolvedValue(undefined), onArchiveNode: vi.fn().mockResolvedValue(undefined), onRestoreNode: vi.fn().mockResolvedValue(undefined), onCreateEdge: vi.fn().mockResolvedValue(undefined), onDeleteEdge: vi.fn().mockResolvedValue(undefined) });

describe('GraphView', () => {
  it('zooms the graph and creates a node from the graph toolbar', async () => {
    const handlers = callbacks();
    render(<GraphView nodes={[node]} edges={[]} activeNodeId="root" {...handlers} />);
    fireEvent.click(screen.getByRole('button', { name: '放大图谱' }));
    expect(screen.getByLabelText('当前缩放比例')).toHaveTextContent('110%');
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

  it('keeps 300 nodes navigable through search, focus and fit view', () => {
    const nodes = Array.from({ length: 300 }, (_, index) => ({ ...node, id: `node-${index}`, title: `讨论 ${index}`, summary: index === 287 ? '唯一检索目标' : '规模测试', x: (index % 20) * 100, y: Math.floor(index / 20) * 80 }));
    render(<GraphView nodes={nodes} edges={[]} activeNodeId="node-287" {...callbacks()} />);
    expect(document.querySelectorAll('.graph-node')).toHaveLength(300);
    expect(document.querySelector('[aria-label="讨论节点：讨论 287"]')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索图谱'), { target: { value: '唯一检索目标' } });
    expect(document.querySelectorAll('.graph-node')).toHaveLength(1);
    fireEvent.keyDown(screen.getByLabelText('搜索图谱'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: '适合全部节点' }));
    expect(screen.getByLabelText('图谱概览').querySelectorAll('i')).toHaveLength(300);
  });
});
