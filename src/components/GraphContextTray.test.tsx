// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { GraphContextTray } from './GraphContextTray';
const preview={workspaceId:'w',expectedNodeId:'current',sources:[{sourceType:'segment' as const,sourceId:'s',sourceRevision:'a'.repeat(64),title:'确切片段',tokens:20}],budget:100,usedTokens:80,overBudget:false,status:'ready' as const};
it('displays exact reviewed source identity and confirms explicitly',()=>{
 const confirm=vi.fn();render(<GraphContextTray targetTitle="当前讨论" preview={preview} busy={false} onConfirm={confirm} onRefresh={vi.fn()} onClose={vi.fn()}/>);
 expect(screen.getByText(/版本 aaaaaaaa/)).toBeInTheDocument();expect(confirm).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'确认加入当前讨论'}));expect(confirm).toHaveBeenCalledOnce();
});
it('blocks over-budget confirmation while keeping manual review available',()=>{
 render(<GraphContextTray targetTitle="当前讨论" preview={{...preview,usedTokens:120,overBudget:true,status:'over_budget'}} busy={false} onConfirm={vi.fn()} onRefresh={vi.fn()} onClose={vi.fn()}/>);
 expect(screen.getByRole('button',{name:'确认加入当前讨论'})).toBeDisabled();expect(screen.getByRole('button',{name:'重新审阅'})).toBeEnabled();expect(screen.getByRole('alert')).toHaveTextContent('当前不会写入');
});
