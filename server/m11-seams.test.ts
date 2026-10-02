import { expect,it } from 'vitest';
import { graphNeighborhood,graphPath,type ProjectedObject,type WorkspaceGraphProjection } from './graph-projection/model';
import { semanticStateChecksum } from './infrastructure/workspace-semantic-checksum';
import type { RuntimePort,RuntimeRequest } from './execution-runtime/runtime';
import type { ExecutionRun } from './execution-runtime/run';

// Observations only: these application-owned fixtures create no product API or persisted object family.
const workspaceId='seam-workspace';
const ref=(objectType:string,objectId=objectType)=>({workspaceId,objectType,objectId});
const objects:ProjectedObject[]=['conversation','task','artifact','workflow-definition','workflow-run','run'].map(type=>({ref:ref(type),revision:1,lifecycle:'active',title:type,summary:'',kind:type,status:'active',createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z'}));
const relations=[['conversation','task'],['task','artifact'],['workflow-definition','workflow-run'],['workflow-run','task'],['workflow-run','run']].map(([source,target],i)=>({id:`seam-${i}`,source:ref(source!),target:ref(target!),relationType:'references',lifecycle:'active' as const,label:'',createdAt:objects[0]!.createdAt}));
const projection:WorkspaceGraphProjection={workspaceId,version:'graph-v1',checkpoint:1,checksum:semanticStateChecksum({objects,relations}),objects,relations};

it('observes Task/Conversation/Artifact and Workflow refs through generic bounded read seams',()=>{
 expect(graphPath(projection,ref('conversation'),ref('artifact')).objects.map(item=>item.ref.objectType)).toEqual(['conversation','task','artifact']);
 expect(graphNeighborhood(projection,{root:ref('workflow-run'),depth:1,nodeLimit:10}).objects.map(item=>item.ref.objectType)).toEqual(expect.arrayContaining(['workflow-definition','workflow-run','task','run']));
 expect(graphNeighborhood(projection,{root:{...ref('task'),workspaceId:'other'}}).objects).toEqual([]);
});

it('observes a fake side-effecting executor through RuntimePort while keeping capabilities application-owned',async()=>{
 const fake:RuntimePort & {side_effects:true}={side_effects:true,listModels:async()=>[],generate:async function*(request){yield {type:'RUN_END',requestId:request.requestId,text:'fixture result',model:'fake',provider:'fake'};}};
 const request:RuntimeRequest={requestId:'run',manifestId:'manifest',projectId:workspaceId,nodeId:'conversation',modelId:'fake',prompt:'fixture',history:[],contextItems:[],mode:'Assisted'};
 const input:ExecutionRun['input']={schemaVersion:'1.0.0',executor:{runtime:'external-fixture',modelSpecRef:'fake',providerEndpointRef:'fixture',model:'fake',provider:'fake'},request};
 const run:ExecutionRun={id:'run',workspaceId,nodeId:'conversation',commandId:'fixture',attempt:1,status:'created',input,inputHash:semanticStateChecksum(input as unknown as Record<string,unknown>),createdAt:objects[0]!.createdAt,telemetry:{traceCount:0}};
 const events=[];for await(const event of fake.generate(request))events.push(event);
 expect(events).toEqual([expect.objectContaining({type:'RUN_END',requestId:run.id})]);expect(fake.side_effects).toBe(true);
 // Current Run/Host contracts have no effect receipt, approval or fencing metadata. M24 must define those before real execution.
 expect(run.input.executor).not.toHaveProperty('side_effects');
});
