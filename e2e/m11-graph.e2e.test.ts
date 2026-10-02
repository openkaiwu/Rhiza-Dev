// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { createSeedWorkspace } from '../server/seed';
import { createApp } from '../server/host-node/create-app';
import { ProviderService } from '../server/provider-service';
import { ProviderStore } from '../server/provider-store';
import { SecretVault } from '../server/secret-vault';
import { NodeEncryptedBlobStore } from '../server/infrastructure/node-encrypted-blob-store';
import { NodeImportArchiveStore } from '../server/infrastructure/portable-content';
import request from 'supertest';
import type { SqlQueryable } from '../server/postgres-store';
import { RepositoryWorkspaceUnitOfWork } from '../server/infrastructure/workspace-repository-unit-of-work';

it('queries a current scoped projection without loading the whole graph, including after a command', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m11-graph-'));
  const store = await openEmbeddedWorkspaceStore(join(root, 'db'));
  try {
    const workspace = await store.read();
    await store.readGraphProjection();
    const read = vi.spyOn(store, 'readGraphProjection').mockRejectedValue(new Error('full graph read forbidden'));
    const uow = new RepositoryWorkspaceUnitOfWork(store);
    const first = await uow.queryGraphNeighborhood({ nodeLimit: 2, edgeLimit: 1, objectTypes: ['conversation'] });
    expect(first.objects.length).toBeLessThanOrEqual(2);
    await store.executeCommand({ context: { commandId: randomUUID(), commandType: 'RenameConversation', actor: { actorType: 'system', actorId: 'test' }, scope: { scopeType: 'workspace', scopeId: workspace.projectId }, occurredAt: new Date().toISOString() },
      apply: async current => ({ next: { ...current, discussionNodes: current.discussionNodes.map(node => node.id === workspace.activeNodeId ? { ...node, title: 'bounded update' } : node) }, value: null }),
      events: () => [{ eventType: 'graph.node.status_changed', aggregateType: 'node', aggregateId: workspace.activeNodeId, payload: {} }] });
    const next = await uow.queryGraphNeighborhood({ root: { workspaceId: workspace.projectId, objectType: 'conversation', objectId: workspace.activeNodeId }, depth: 1, nodeLimit: 2, edgeLimit: 1 });
    expect(next.objects.find(item => item.ref.objectId === workspace.activeNodeId)?.title).toBe('bounded update');
    expect(read).not.toHaveBeenCalled();
    await expect(uow.queryGraphNeighborhood({ root: { workspaceId: randomUUID(), objectType: 'conversation', objectId: workspace.activeNodeId } })).rejects.toMatchObject({ code: 'WORKSPACE_REFERENCE_MISMATCH' });
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});

it('scrubs removed Segment content and containment edges from every retained graph namespace', async()=>{
 const root=await mkdtemp(join(tmpdir(),'rhiza-m11-purge-'));const uploads=join(root,'uploads');const blobs=NodeEncryptedBlobStore.atDirectory(uploads);const store=await openEmbeddedWorkspaceStore(join(root,'db'),undefined,'apply',blobs,new NodeImportArchiveStore(join(uploads,'imports')));
 try{
  const seed=createSeedWorkspace();const node={...seed.discussionNodes[0]!,id:randomUUID()};const messageId=randomUUID(),segmentId=randomUUID();
  await store.initialize({...seed,activeNodeId:node.id,discussionNodes:[{...node,status:'active',sourceNodeId:undefined,sourceMessageId:undefined}],messages:[{id:messageId,nodeId:node.id,kind:'assistant',text:'secret segment text',createdAt:node.createdAt,segmentId}],segments:[{id:segmentId,nodeId:node.id,title:'secret segment title',ordinal:0,createdAt:node.createdAt}],anchors:[{id:randomUUID(),nodeId:node.id,segmentId,messageId,selectedText:'secret segment text',startOffset:0,endOffset:19,createdAt:node.createdAt}],discussionEdges:[],manifests:[],contextItems:[],attachments:[],resources:[],resourceVersions:[],materializations:[],fileChunks:[],auditEvents:[]});
  const provider=new ProviderService(new ProviderStore(join(root,'providers')),new SecretVault(join(root,'key')),{baseUrl:'https://example.test',apiKey:'',model:'fixture',providerName:'Fixture',chatPath:'/chat',timeoutMs:1000,temperature:0,extraHeaders:{},allowNoKey:true});const app=createApp(store,provider,false,undefined,undefined,uploads,blobs);
  await request(app).get('/api/workspace').expect(200);await store.backfillJournal();await store.readGraphProjection();await store.rebuildGraphProjection();
  await request(app).post('/api/graph/nodes').send({title:'Retained'}).expect(201);await request(app).patch(`/api/nodes/${node.id}/status`).send({status:'archived'}).expect(200);await request(app).post(`/api/graph/nodes/${node.id}/purge`).send({confirmation:`PURGE ${node.id}`,reason:'regression'}).expect(200);
  const database=(store as unknown as {database:SqlQueryable}).database;const rows=await database.query('SELECT * FROM workspace_objects WHERE workspace_id=$1',[store.defaultWorkspaceId]);expect(JSON.stringify(rows.rows)).not.toContain('secret segment');
  const edges=await database.query<{label:string;lifecycle_status:string}>("SELECT label,lifecycle_status FROM graph_relations WHERE workspace_id=$1 AND (source_id=$2 OR target_id=$2)",[store.defaultWorkspaceId,segmentId]);expect(edges.rows.every(edge=>edge.label===''&&edge.lifecycle_status==='retracted')).toBe(true);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
it('upgrades an old materializer namespace once before serving Segment neighborhoods',async()=>{
 const root=await mkdtemp(join(tmpdir(),'rhiza-m11-upgrade-'));const store=await openEmbeddedWorkspaceStore(join(root,'db'));
 try{const workspace=await store.read();await store.readGraphProjection();const database=(store as unknown as {database:SqlQueryable}).database;const alias=(await database.query<{active_version:string}>("SELECT active_version FROM projection_aliases WHERE workspace_id=$1",[workspace.projectId])).rows[0]!.active_version;
 for(const table of ['workspace_objects','graph_relations','projection_checkpoints'])await database.query(`UPDATE ${table} SET projection_version='graph-v1-legacy' WHERE workspace_id=$1 AND projection_version=$2`,[workspace.projectId,alias]);await database.query("UPDATE projection_aliases SET active_version='graph-v1-legacy' WHERE workspace_id=$1",[workspace.projectId]);await database.query("DELETE FROM workspace_objects WHERE workspace_id=$1 AND object_type='segment'",[workspace.projectId]);await database.query("DELETE FROM graph_relations WHERE workspace_id=$1 AND relation_type='contains'",[workspace.projectId]);
 const result=await store.queryGraphNeighborhood({root:{workspaceId:workspace.projectId,objectType:'conversation',objectId:workspace.activeNodeId},depth:2});expect(result.objects.some(object=>object.ref.objectType==='segment')).toBe(true);expect(result.version).toMatch(/^graph-v2-/);const next=await store.queryGraphNeighborhood({nodeLimit:1});expect(next.version).toBe(result.version);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
