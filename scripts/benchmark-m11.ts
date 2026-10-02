import { mkdtemp,rm,writeFile,mkdir } from 'node:fs/promises';
import { tmpdir,platform,arch,release } from 'node:os';
import { join,dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { PGlite } from '@electric-sql/pglite';
import { loadMigrations } from './migrate';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { PostgresWorkspaceStore } from '../server/postgres-store';
import { BoundedGraphQueries } from '../server/graph-projection/bounded-queries';
import { createSeedWorkspace } from '../server/seed';
import { semanticStateChecksum } from '../server/infrastructure/workspace-semantic-checksum';
import type { ExecutionRun } from '../server/execution-runtime/run';
import { RunTraceBuffer } from '../server/execution-runtime/run';

const root=await mkdtemp(join(tmpdir(),'rhiza-m11-benchmark-'));const store=await openEmbeddedWorkspaceStore(join(root,'commands'));const graphDb=new PGlite();
const profile={warmup_count:20,sample_count:200,concurrency:1,external_network:false};
async function measure(work:()=>Promise<unknown>){for(let i=0;i<20;i++)await work();const samples:number[]=[];for(let i=0;i<200;i++){const start=performance.now();await work();samples.push(performance.now()-start);}const sorted=[...samples].sort((a,b)=>a-b);return {p50:sorted[99],p95:sorted[189],p99:sorted[197],max:sorted[199],samples_ms:samples};}
try{
 const seed=createSeedWorkspace();await store.initialize({...seed,discussionNodes:[...seed.discussionNodes,...Array.from({length:300-seed.discussionNodes.length},(_,i)=>({...seed.discussionNodes[0],id:randomUUID(),title:`Fixture ${i}`,sourceNodeId:undefined,sourceMessageId:undefined,anchorText:undefined,x:i%20*100,y:Math.floor(i/20)*80}))]});await store.backfillJournal();const workspace=await store.read();await store.workspaceDirectory.ensureWorkspace({workspaceId:workspace.projectId,name:'M11 fixture',status:'active',createdBy:'00000000-0000-4000-8000-000000000002',revision:1});
 let ordinal=0;const command=()=>store.executeCommand({context:{commandId:randomUUID(),commandType:'RenameConversation',actor:{actorType:'system',actorId:'m11-fixture'},scope:{scopeType:'workspace',scopeId:workspace.projectId},occurredAt:new Date().toISOString()},apply:async current=>({next:{...current,discussionNodes:current.discussionNodes.map(node=>node.id===current.activeNodeId?{...node,title:`Fixture command ${++ordinal}`}:node)},value:null}),events:()=>[{eventType:'conversation.renamed',aggregateType:'conversation',aggregateId:workspace.activeNodeId,payload:{}}]});
 const commandMetric=await measure(command);
 const contextMetric=await measure(()=>store.queryContextCandidates({workspaceId:workspace.projectId,nodeId:workspace.activeNodeId,mode:'Assisted',query:'fixture context',selection:[],attachmentIds:[],budget:32000}));
 const now=new Date().toISOString();const input:ExecutionRun['input']={schemaVersion:'1.0.0',executor:{runtime:'fixture',modelSpecRef:'fixture',providerEndpointRef:'fixture',model:'fixture',provider:'fixture'},request:{requestId:randomUUID(),manifestId:randomUUID(),projectId:workspace.projectId,nodeId:workspace.activeNodeId,modelId:'fixture',prompt:'synthetic trace fixture',history:[],contextItems:[],mode:'Assisted'}};
 const run:ExecutionRun={id:input.request.requestId,workspaceId:workspace.projectId,nodeId:workspace.activeNodeId,commandId:randomUUID(),status:'created',attempt:1,input,inputHash:semanticStateChecksum(input as unknown as Record<string,unknown>),createdAt:now,telemetry:{traceCount:0}};
 await store.executeCommand({context:{commandId:run.commandId,commandType:'CreateConversationRun',actor:{actorType:'system',actorId:'fixture'},scope:{scopeType:'workspace',scopeId:workspace.projectId},occurredAt:now},options:{run:{kind:'create',run}},apply:async current=>({next:current,value:null}),events:()=>[{eventType:'run.created',aggregateType:'run',aggregateId:run.id,payload:{}}]});
 // Warm primary commands first, then record the 10k flood concurrently with the measured primary sample.
 for(let i=0;i<20;i++)await command();
 const trace=new RunTraceBuffer(batch=>store.writeRunTraces(run.id,1,batch));
 const flood=async()=>{for(let i=0;i<10000;i++)await trace.push('CONTENT_DELTA',now);await trace.flush();};
 const loadedSamples:number[]=[];await Promise.all([flood(),(async()=>{for(let i=0;i<200;i++){const start=performance.now();await command();loadedSamples.push(performance.now()-start);}})()]);
 const sorted=[...loadedSamples].sort((a,b)=>a-b);const tracePrimary={p95:sorted[189],p99:sorted[197],samples_ms:loadedSamples,trace_count:trace.count,regression_percent:(sorted[189]/commandMetric.p95-1)*100};
 for(const migration of await loadMigrations())await graphDb.exec(migration.sql);const graphStore=new PostgresWorkspaceStore(graphDb);const graphWorkspace=await graphStore.read();const w=graphWorkspace.projectId;
 // Dedicated projection initializer for synthetic scale data. No business database is touched.
 await graphDb.query("INSERT INTO projection_aliases(workspace_id,projection_name,active_version) VALUES($1,'graph','m11-scale')",[w]);await graphDb.query("INSERT INTO projection_checkpoints(workspace_id,projection_name,projection_version,last_sequence,semantic_checksum) VALUES($1,'graph','m11-scale',1,repeat('a',64))",[w]);
 await graphDb.query(`INSERT INTO workspace_objects(workspace_id,projection_version,object_type,object_id,revision,lifecycle_status,title,summary,kind,object_status,created_at,updated_at,metadata) SELECT $1,'m11-scale','conversation','node-'||i,1,'active','Node '||i,'','branch','active',now(),now(),'{}'::jsonb FROM generate_series(0,9999) i`,[w]);
 await graphDb.query(`INSERT INTO graph_relations(workspace_id,projection_version,relation_id,source_type,source_id,target_type,target_id,relation_type,lifecycle_status,label,created_at) SELECT $1,'m11-scale','edge-'||i,'conversation','node-'||(i%10000),'conversation','node-'||((i*37+1)%10000),'related_to','active','',now() FROM generate_series(0,49999) i`,[w]);
 const graph=new BoundedGraphQueries(graphDb,w);const graphMetric=await measure(async()=>{const result=await graph.neighborhood({root:{workspaceId:w,objectType:'conversation',objectId:'node-0'},depth:1,nodeLimit:200,edgeLimit:800});if(result.objects.length>200||result.relations.length>800)throw new Error('GRAPH_BOUND_EXCEEDED');});
 const assertions={command_p95:commandMetric.p95<=200,command_p99:commandMetric.p99<=500,graph_p95:graphMetric.p95<=150,graph_p99:graphMetric.p99<=400,context_p95:contextMetric.p95<=250,trace_regression:tracePrimary.regression_percent<=25};
 const result={schemaVersion:'1.0.0',kind:'local_synthetic_performance',commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),workingTreeDirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),environment:{node:process.version,platform:platform(),arch:arch(),release:release(),commandBackend:'encrypted PGlite, 300 Conversations',graphBackend:'PGlite projection initializer',objects:10000,relations:50000},profile,metrics:{command:commandMetric,context:contextMetric,graph:graphMetric,tracePrimary},assertions,ok:Object.values(assertions).every(Boolean),g0Relative:{status:'pending',reason:'Archived Linux JSON fixture baseline differs from this encrypted macOS PGlite profile; no comparable relative pass is claimed.'}};
 const output=process.argv.includes('--output')?process.argv[process.argv.indexOf('--output')+1]:'reports/m11-m14/performance.json';{await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');}console.info(JSON.stringify({output,ok:result.ok,assertions,metrics:Object.fromEntries(Object.entries(result.metrics).map(([key,value])=>[key,{p95:value.p95,...('p99' in value?{p99:value.p99}:{}),...('regression_percent' in value?{regression_percent:value.regression_percent}:{})}]))}));if(!result.ok)process.exitCode=1;
}catch(error){console.error(JSON.stringify({ok:false,error:error instanceof Error?error.message:'BENCHMARK_FAILED'}));process.exitCode=1;}finally{await store.close();await graphDb.close();await rm(root,{recursive:true,force:true});}
