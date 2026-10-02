// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GraphView } from './GraphView';
const node={id:'n',title:'讨论来源',summary:'Summary',status:'active' as const,kind:'main' as const,x:100,y:100};
const segment={...node,id:'s',title:'片段来源',objectType:'segment' as const,parentId:'n',x:280};
const handlers=()=>({onMove:vi.fn(),onActivate:vi.fn(),onCreateNode:vi.fn(),onArchiveNode:vi.fn(),onRestoreNode:vi.fn(),onCreateEdge:vi.fn(),onDeleteEdge:vi.fn(),onBatch:vi.fn()});
it('uses the same exact multi-source review from keyboard selection and the drag handle, without activation',()=>{
 const review=vi.fn(),actions=handlers();render(<GraphView nodes={[node,segment]} edges={[]} activeNodeId="n" {...actions} displayFilters={{layers:['conversation','segment']}} onPreviewContext={review} contextTray={<p>Review target</p>}/>);
 fireEvent.click(screen.getByRole('button',{name:'批量选择'}));fireEvent.click(screen.getByRole('checkbox',{name:'选择讨论 讨论来源'}));fireEvent.click(screen.getByRole('checkbox',{name:'选择片段 片段来源'}));
 fireEvent.click(screen.getByRole('button',{name:'审阅所选来源'}));expect(review).toHaveBeenLastCalledWith([node,segment]);
 const transfer={effectAllowed:'',setData:vi.fn()};fireEvent.dragStart(screen.getByRole('button',{name:'拖动所选来源 · 2'}),{dataTransfer:transfer});fireEvent.drop(screen.getByRole('region',{name:'Context 来源托盘'}),{dataTransfer:transfer});
 expect(review).toHaveBeenCalledTimes(2);expect(review).toHaveBeenLastCalledWith([node,segment]);expect(actions.onActivate).not.toHaveBeenCalled();expect(actions.onMove).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'归档所选讨论'})).toBeDisabled();
 fireEvent.drop(screen.getByRole('region',{name:'Context 来源托盘'}),{dataTransfer:{getData:()=>JSON.stringify([{sourceId:'foreign'}])}});expect(review).toHaveBeenCalledTimes(2);
});
it('restores explicit layers at 80% and shares display filters without changing Context',async()=>{
 const share=vi.fn().mockResolvedValue(true),actions=handlers(),context=vi.fn(),filter=vi.fn();
 render(<GraphView nodes={[node,segment]} edges={[]} activeNodeId="n" {...actions} displayFilters={{layers:['segment'],query:'片段',relationTypes:['references']}} onShareFilters={share} onContext={context} onFilter={filter}/>);
 await screen.findByRole('button',{name:'讨论节点：片段来源'});expect(screen.queryByRole('button',{name:'讨论节点：讨论来源'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'分享当前过滤'}));expect(share).toHaveBeenCalledWith({layers:['segment'],query:'片段',relationTypes:['references']});
 await waitFor(()=>expect(filter).toHaveBeenCalledWith(expect.objectContaining({objectTypes:['segment'],query:'片段'})));expect(context).not.toHaveBeenCalled();expect(actions.onActivate).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('checkbox',{name:'显示相关关系'}));fireEvent.click(screen.getByRole('button',{name:'分享当前过滤'}));expect(share).toHaveBeenLastCalledWith({layers:['segment'],query:'片段',relationTypes:['references','related-to']});expect(context).not.toHaveBeenCalled();
});
it('blocks tray review on read-only workspaces and during confirmation',()=>{
 const review=vi.fn();const base={nodes:[node],edges:[],activeNodeId:'n',...handlers(),onPreviewContext:review};const view=render(<GraphView {...base} readOnly/>);
 fireEvent.click(screen.getByRole('button',{name:'批量选择'}));fireEvent.click(screen.getByRole('checkbox',{name:'选择讨论 讨论来源'}));expect(screen.getByRole('button',{name:'审阅所选来源'})).toBeDisabled();
 view.rerender(<GraphView {...base} contextBusy/>);expect(screen.getByRole('checkbox',{name:'选择讨论 讨论来源'})).toBeDisabled();expect(screen.getByRole('button',{name:'审阅所选来源'})).toBeDisabled();expect(review).not.toHaveBeenCalled();
});
