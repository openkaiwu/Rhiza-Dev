type Viewport = { x:number;y:number;scale:number };
/** Exact rectangle intersection. No overscan: offscreen nodes have no canvas DOM. */
export function visibleGraphNodes<T extends {x:number;y:number}>(nodes:readonly T[],viewport:Viewport,size:{width:number;height:number}):T[] {
 return nodes.filter(node=>{const x=node.x*viewport.scale+viewport.x,y=node.y*viewport.scale+viewport.y;return x<size.width&&y<size.height&&x+148*viewport.scale>0&&y+84*viewport.scale>0;});
}
type Ref={workspaceId:string;objectType:string;objectId:string};const key=(ref:Ref)=>`${ref.workspaceId}:${ref.objectType}:${ref.objectId}`;
/** Retain bounded cross-page edges; drop edges incident to known evicted objects. */
export function boundedGraphCache<O extends {ref:Ref},R extends {id:string;source:Ref;target:Ref},G extends {objects:O[];relations:R[]}>(graph:G):G {
 const allObjects=[...new Map(graph.objects.map(item=>[key(item.ref),item])).values()];
 const objects=allObjects.slice(-1000);const evicted=new Set(allObjects.slice(0,Math.max(0,allObjects.length-1000)).map(item=>key(item.ref)));
 const relations=[...new Map(graph.relations.map(item=>[item.id,item])).values()].filter(edge=>!evicted.has(key(edge.source))&&!evicted.has(key(edge.target))).slice(-4000);
 return {...graph,objects,relations};
}
