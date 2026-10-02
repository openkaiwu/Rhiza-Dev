type Viewport = { x:number;y:number;scale:number };
/** Exact rectangle intersection. No overscan: offscreen nodes have no canvas DOM. */
export function visibleGraphNodes<T extends {x:number;y:number}>(nodes:readonly T[],viewport:Viewport,size:{width:number;height:number}):T[] {
 return nodes.filter(node=>{const x=node.x*viewport.scale+viewport.x,y=node.y*viewport.scale+viewport.y;return x<size.width&&y<size.height&&x+148*viewport.scale>0&&y+84*viewport.scale>0;});
}
type Ref={workspaceId:string;objectType:string;objectId:string};const key=(ref:Ref)=>`${ref.workspaceId}:${ref.objectType}:${ref.objectId}`;
/** Keep recent neighborhoods and references only while their endpoints are resident. */
export function boundedGraphCache<O extends {ref:Ref},R extends {id:string;source:Ref;target:Ref},G extends {objects:O[];relations:R[]}>(graph:G):G {
 const objects=[...new Map(graph.objects.map(item=>[key(item.ref),item])).values()].slice(-1000);const ids=new Set(objects.map(item=>key(item.ref)));
 const relations=[...new Map(graph.relations.map(item=>[item.id,item])).values()].filter(edge=>ids.has(key(edge.source))&&ids.has(key(edge.target))).slice(-4000);
 return {...graph,objects,relations};
}
