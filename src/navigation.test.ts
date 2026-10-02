import { formatLocation, parseLocation, readRecents, updateRecents, type WorkspaceLocation } from './navigation';
describe('Workspace navigation identities', () => {
  it('roundtrips opaque ids and exact history identities without double decoding', () => {
    const locations: WorkspaceLocation[] = [
      {kind:'message',workspaceId:'w / 中文',nodeId:'n%2F',objectId:'old/message',detail:'context'},
      {kind:'manifest',workspaceId:'w',objectId:'manifest',sourceIndex:0},
      {kind:'graph',workspaceId:'w',objectType:'message',objectId:'message',versionId:'v/%'},
      {kind:'resources',workspaceId:'w',objectId:'resource',versionId:'old-version'},
      {kind:'collaboration',workspaceId:'w',nodeId:'n',objectId:'review'},
    ];
    for (const location of locations) expect(parseLocation(formatLocation(location))).toEqual(location);
  });
  it('rejects malformed, unrecognized and content-bearing routes instead of falling back', () => {
    for (const hash of ['#workspace-main','#/workspaces/w//graph','#/workspaces/%GG/graph','#/workspaces/w/conversations/n/messages/m/guess','#/workspaces/w/graph?query=secret','#/workspaces/w/context/manifests/m/sources/-1','#/workspaces/w/graph/objects/message/m?versionId=a&versionId=b']) expect(parseLocation(hash).kind).toBe('invalid');
  });
  it('bounds and deduplicates scoped recents without retaining titles or content', () => {
    let recent = updateRecents([], {kind:'conversation',workspaceId:'other',nodeId:'other'});
    for(let i=0;i<25;i++)recent=updateRecents(recent,{kind:'message',workspaceId:'w',nodeId:'n',objectId:`m${i}`},i);
    recent=updateRecents(recent,{kind:'message',workspaceId:'w',nodeId:'n',objectId:'m24'},30);
    expect(recent.filter(item=>item.workspaceId==='w')).toHaveLength(20); expect(recent.filter(item=>item.workspaceId==='other')).toHaveLength(1);
    expect(Object.keys(recent[0])).toEqual(['workspaceId','canonicalLocation','visitedAt']);
    expect(readRecents({getItem:()=>JSON.stringify(recent)})).toEqual(recent);
    expect(readRecents({getItem:()=>JSON.stringify([{...recent[0],title:'private body'}])})).toEqual([]);
    expect(readRecents({getItem:()=>'{broken'})).toEqual([]);
    expect(readRecents({getItem:()=>JSON.stringify([{workspaceId:'wrong',canonicalLocation:'#/workspaces/w/conversations/n',visitedAt:1}])})).toEqual([]);
  });
});
