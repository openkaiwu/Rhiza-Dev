// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ConversationManager } from './ConversationManager';
vi.mock('../api',()=>({api:{workspaceId:()=> 'workspace'}}));
it('locates a Segment by its original Anchor rather than a new current selection',()=>{
 const locate=vi.fn();
 render(<ConversationManager node={{id:'node',title:'Node',summary:'',status:'active',kind:'branch',x:0,y:0,createdAt:'',updatedAt:''}} segments={[{id:'segment',nodeId:'node',title:'Saved range',ordinal:0,createdAt:''}]} anchors={[{id:'anchor',nodeId:'node',segmentId:'segment',messageId:'original-version',selectedText:'saved',createdAt:''}]} messages={[]} catalog={{providers:[],models:[],activeModelId:null}} range={{messageId:'new-selection',selectedText:'new',startOffset:0,endOffset:3}} onChanged={()=>{}} onLocate={locate} onMerge={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Saved range'}));
 expect(locate).toHaveBeenCalledWith('original-version');
 expect(screen.getByRole('button',{name:'选择合并目标'})).toBeEnabled();
});
