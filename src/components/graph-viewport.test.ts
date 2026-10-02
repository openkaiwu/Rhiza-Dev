import { describe,expect,it } from 'vitest';
import { visibleGraphNodes, boundedGraphCache } from './graph-viewport';
describe('M14 viewport and cache', () => {
  it('keeps intersecting rectangles and excludes every offscreen rectangle at each zoom', () => {
    const nodes = [{id:'in',x:10,y:10},{id:'edge',x:-147,y:0},{id:'out',x:601,y:0},{id:'above',x:0,y:-117}];
    expect(visibleGraphNodes(nodes,{x:0,y:0,scale:1},{width:600,height:400}).map(node=>node.id)).toEqual(['in','edge']);
    expect(visibleGraphNodes(nodes,{x:-1200,y:0,scale:2},{width:600,height:400}).map(node=>node.id)).toEqual(['out']);
  });
  it('bounds the merged cache and drops relations whose endpoints were evicted', () => {
    const objects=Array.from({length:1200},(_,i)=>({ref:{workspaceId:'w',objectType:'conversation',objectId:String(i)}}));
    const relations=Array.from({length:5000},(_,i)=>({id:String(i),source:objects[i%1200].ref,target:objects[(i+1)%1200].ref}));
    const result=boundedGraphCache({objects,relations});
    expect(result.objects).toHaveLength(1000);expect(result.relations.length).toBeLessThanOrEqual(4000);
    const ids=new Set(result.objects.map(item=>item.ref.objectId));expect(result.relations.every(edge=>ids.has(edge.source.objectId)&&ids.has(edge.target.objectId))).toBe(true);
  });
});

it('retains a bounded relation until its later object page arrives', () => {
 const a={ref:{workspaceId:'w',objectType:'conversation',objectId:'a'}},b={ref:{workspaceId:'w',objectType:'conversation',objectId:'b'}};
 const edge={id:'cross-page',source:a.ref,target:b.ref};
 const first=boundedGraphCache({objects:[a],relations:[edge]});
 expect(first.relations).toEqual([edge]);
 expect(boundedGraphCache({...first,objects:[...first.objects,b]}).relations).toEqual([edge]);
});

it('keeps the visible edge of a readable node while it is panned offscreen', () => {
  const nodes = [{id:'left-edge', x:-220, y:20}, {id:'top-edge', x:20, y:-115}, {id:'outside', x:-225, y:20}];
  expect(visibleGraphNodes(nodes, {x:0,y:0,scale:1}, {width:600,height:400}).map(node => node.id)).toEqual(['left-edge', 'top-edge']);
});
