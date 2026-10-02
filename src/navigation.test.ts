import { act, renderHook, waitFor } from '@testing-library/react';
import { formatLocation, parseLocation, readRecents, updateRecents, useWorkspaceNavigation, type WorkspaceLocation } from './navigation';
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

describe('Shareable Graph display filters', () => {
  const filtered: WorkspaceLocation = { kind: 'graph', workspaceId: 'w / 中文', graphFilters: {
    layers: ['conversation', 'message'], query: '资料 + 100% / 节点', statuses: ['draft', 'active'],
    relationTypes: ['references', 'merged-into'], updatedAfter: '2024-02-29',
  } };
  const canonical = '#/workspaces/w%20%2F%20%E4%B8%AD%E6%96%87/graph?layers=conversation%2Cmessage&q=%E8%B5%84%E6%96%99%20%2B%20100%25%20%2F%20%E8%8A%82%E7%82%B9&statuses=draft%2Cactive&relations=references%2Cmerged-into&updatedAfter=2024-02-29';

  it('roundtrips bounded display filters with canonical parameter and enum ordering', () => {
    expect(formatLocation(filtered)).toBe(canonical);
    expect(parseLocation(canonical)).toEqual(filtered);
    const reordered = '#/workspaces/w%20%2F%20%E4%B8%AD%E6%96%87/graph?updatedAfter=2024-02-29&relations=merged-into,references&statuses=active,draft&q=%E8%B5%84%E6%96%99%20%2B%20100%25%20%2F%20%E8%8A%82%E7%82%B9&layers=message,conversation';
    expect(parseLocation(reordered)).toEqual(filtered);
    expect(formatLocation(parseLocation(reordered))).toBe(canonical);
  });

  it('does not insert default layers when only a search or status is shared', () => {
    const search = { kind: 'graph', workspaceId: 'w', graphFilters: { query: '资料' } } as WorkspaceLocation;
    expect(parseLocation(formatLocation(search))).toEqual(search);
    expect(parseLocation('#/workspaces/w/graph')).toEqual({ kind: 'graph', workspaceId: 'w' });
    expect(formatLocation({ kind: 'graph', workspaceId: 'w', graphFilters: {} })).toBe('#/workspaces/w/graph');
    expect(parseLocation('#/workspaces/w/graph?q=%252F').graphFilters?.query).toBe('%2F');
  });

  it('accepts the largest explicit lists and the 200-character search boundary', () => {
    const maximum: WorkspaceLocation = { kind: 'graph', workspaceId: 'w', graphFilters: {
      layers: ['conversation', 'segment', 'message'], query: '中'.repeat(200), statuses: ['draft', 'active', 'resolved', 'stale'],
      relationTypes: ['derived-from', 'references', 'related-to', 'merged-into'], updatedAfter: '9999-12-31',
    } };
    expect(parseLocation(formatLocation(maximum))).toEqual(maximum);
  });

  it('rejects oversized raw URLs even when each decoded filter is individually valid', () => {
    const encoded = (value: string) => [...value].map(char => `%${char.charCodeAt(0).toString(16)}`).join('');
    const query = `q=${encodeURIComponent('中'.repeat(200))}&layers=${encoded('conversation,segment,message')}&statuses=${encoded('draft,active,resolved,stale')}&relations=${encoded('derived-from,references,related-to,merged-into')}&updatedAfter=2024-02-29`;
    expect(query.length).toBeGreaterThan(2048);
    expect(parseLocation(`#/workspaces/w/graph?${query}`).kind).toBe('invalid');
  });

  it.each([
    'layers=', 'layers=conversation,', 'layers=message,message', 'layers=resource', 'layers=conversation,segment,message,message',
    'statuses=archived', 'statuses=active,unknown', 'statuses=active,active', 'statuses=draft,active,resolved,stale,active',
    'relations=contains', 'relations=references,references', 'relations=derived-from,references,related-to,merged-into,related-to',
    'q=', 'q=%20%20', `q=${'a'.repeat(201)}`, 'q=%00', 'q=%0A', 'q=%C2%85', 'q=%GG', 'q=%E0%A4',
    'updatedAfter=2023-02-29', 'updatedAfter=2026-04-31', 'updatedAfter=0000-01-01', 'updatedAfter=2026-13-01',
    'updatedAfter=2026-1-01', 'updatedAfter=2026-10-02T00%3A00%3A00.000Z',
    'q=a&q=b', 'layers=message&layers=segment', 'query=secret', 'cursor=private', 'q=a&', `q=${'a'.repeat(2049)}`,
  ])('rejects invalid or non-display filter input: %s', query => {
    expect(parseLocation(`#/workspaces/w/graph?${query}`).kind).toBe('invalid');
  });

  it('keeps root filters out of object/version links and other views', () => {
    expect(parseLocation('#/workspaces/w/graph/objects/message/m?versionId=old%2Fv')).toEqual({ kind: 'graph', workspaceId: 'w', objectType: 'message', objectId: 'm', versionId: 'old/v' });
    for (const route of ['graph/objects/message/m?q=a', 'graph/objects/message/m?versionId=v&layers=message', 'runs?q=a', 'resources?layers=message']) {
      expect(parseLocation(`#/workspaces/w/${route}`).kind).toBe('invalid');
    }
    expect(() => formatLocation({ kind: 'graph', workspaceId: 'w', graphFilters: { layers: [] } })).toThrow();
    expect(() => formatLocation({ kind: 'graph', workspaceId: 'w', graphFilters: { query: 'a\nsecret' } })).toThrow();
  });

  it('deduplicates canonical Graph recents while preserving and checking Workspace scope', () => {
    const other = updateRecents([], { kind: 'graph', workspaceId: 'other' }, 1);
    const first = updateRecents(other, filtered, 2);
    const recent = updateRecents(first, { ...filtered, graphFilters: { ...filtered.graphFilters, layers: ['message', 'conversation'] } }, 3);
    const recentCanonical = formatLocation({ ...filtered, graphFilters: { ...filtered.graphFilters, query: undefined } });
    expect(recent).toEqual([{ workspaceId: filtered.workspaceId, canonicalLocation: recentCanonical, visitedAt: 3 }, ...other]);
    expect(JSON.stringify(recent)).not.toContain('q=');
    expect(readRecents({ getItem: () => JSON.stringify(recent) })).toEqual(recent);
    expect(readRecents({ getItem: () => JSON.stringify([{ ...recent[0], workspaceId: 'foreign' }]) })).toEqual([]);
    expect(readRecents({ getItem: () => JSON.stringify([{ workspaceId: filtered.workspaceId, canonicalLocation: canonical, visitedAt: 3 }]) })).toEqual([]);
  });

  it('restores shared Graph filters and personal presentation through browser Back', async () => {
    window.history.replaceState(null, '', '/'); localStorage.clear();
    const { result } = renderHook(() => useWorkspaceNavigation());
    act(() => { result.current.navigate(filtered); result.current.rememberGraph({ viewport: { x: 12, y: 20, scale: 0.8 } }); });
    act(() => result.current.navigate({ kind: 'message', workspaceId: filtered.workspaceId, nodeId: 'n', objectId: 'm' }));
    act(() => window.history.back());
    await waitFor(() => expect(result.current.location).toEqual(filtered));
    expect(result.current.restoration?.graph).toEqual({ viewport: { x: 12, y: 20, scale: 0.8 } });
    expect(window.location.hash).toBe(canonical);
  });
});
