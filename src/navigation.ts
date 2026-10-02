import { useCallback, useEffect, useRef, useState } from 'react';
import type { View } from './types';
export type LocationKind = 'bootstrap' | 'invalid' | 'chooser' | 'settings' | 'workspace' | 'conversations' | 'conversation' | 'message' | 'segment' | 'collaboration' | 'context' | 'manifest' | 'graph' | 'resources' | 'state' | 'runs' | 'activity' | 'data';
export interface WorkspaceLocation { kind: LocationKind; workspaceId?: string; nodeId?: string; objectId?: string; objectType?: string; versionId?: string; detail?: 'context' | 'provenance'; sourceIndex?: number }
export function formatLocation(l: WorkspaceLocation): string {
  if (l.kind === 'chooser') return '#/workspaces';
  if (l.kind === 'settings') return '#/settings/providers';
  if (!l.workspaceId) return '#/workspaces';
  const root = `#/workspaces/${encodeURIComponent(l.workspaceId)}`, id = encodeURIComponent(l.objectId ?? ''), node = encodeURIComponent(l.nodeId ?? '');
  switch (l.kind) {
    case 'workspace': return root;
    case 'conversation': return `${root}/conversations/${node}`;
    case 'message': return `${root}/conversations/${node}/messages/${id}${l.detail ? `/${l.detail}` : ''}`;
    case 'segment': return `${root}/conversations/${node}/segments/${id}`;
    case 'collaboration': return `${root}/conversations/${node}/collaborations/${id}`;
    case 'manifest': return `${root}/context/manifests/${id}${l.sourceIndex !== undefined ? `/sources/${l.sourceIndex}` : ''}`;
    case 'graph': return `${root}/graph${l.objectId ? `/objects/${encodeURIComponent(l.objectType ?? '')}/${id}${l.versionId ? `?versionId=${encodeURIComponent(l.versionId)}` : ''}` : ''}`;
    case 'resources': return `${root}/resources${l.objectId ? `/${id}${l.versionId ? `/versions/${encodeURIComponent(l.versionId)}` : ''}` : ''}`;
    case 'runs': return `${root}/runs${l.objectId ? `/${id}` : ''}`;
    default: return `${root}/${l.kind}`;
  }
}
export function parseLocation(hash: string): WorkspaceLocation {
  if (!hash) return { kind: 'bootstrap' };
  try {
    if (!hash.startsWith('#/') || hash.split('?').length > 2) return { kind: 'invalid' };
    const [path, query = ''] = hash.slice(2).split('?'); const p = path.split('/').map(decodeURIComponent);
    if (p.some(part => !part || [...part].some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127))) return { kind: 'invalid' };
    if (!query && p.join('/') === 'settings/providers') return { kind: 'settings' };
    if (p[0] !== 'workspaces') return { kind: 'invalid' };
    if (p.length === 1 && !query) return { kind: 'chooser' };
    if (!p[1]) return { kind: 'invalid' }; const base = { workspaceId: p[1] }; const t = p.slice(2);
    if (!t.length && !query) return { ...base, kind: 'workspace' };
    if (query && !(t[0] === 'graph' && t.length === 4)) return { kind: 'invalid' };
    if (t.length === 1 && ['conversations','context','graph','resources','state','runs','activity','data'].includes(t[0])) return { ...base, kind: t[0] as LocationKind };
    if (t[0] === 'conversations') {
      if (t.length === 2) return { ...base, kind: 'conversation', nodeId: t[1] };
      const kind = ({ messages:'message', segments:'segment', collaborations:'collaboration' } as Record<string, LocationKind>)[t[2]];
      if (kind && t.length === 4) return { ...base, kind, nodeId: t[1], objectId: t[3] };
      if (kind === 'message' && t.length === 5 && ['context','provenance'].includes(t[4])) return { ...base, kind, nodeId:t[1], objectId:t[3], detail:t[4] as WorkspaceLocation['detail'] };
    }
    if (t[0] === 'context' && t[1] === 'manifests') {
      if (t.length === 3) return { ...base, kind:'manifest', objectId:t[2] };
      if (t.length === 5 && t[3] === 'sources' && /^(0|[1-9][0-9]*)$/.test(t[4]) && Number(t[4]) < 10000) return { ...base, kind:'manifest', objectId:t[2], sourceIndex:Number(t[4]) };
    }
    if (t[0] === 'graph' && t[1] === 'objects' && t.length === 4) {
      for (const token of query.split('&').flatMap(part=>part.split('='))) decodeURIComponent(token);
      const params = new URLSearchParams(query), versionId = params.get('versionId') ?? undefined;
      if ([...params.keys()].some(key=>key!=='versionId') || params.getAll('versionId').length>1 || (query&&!versionId)) return { kind:'invalid' };
      return { ...base, kind:'graph', objectType:t[2], objectId:t[3], versionId };
    }
    if (t[0] === 'resources' && (t.length === 2 || (t.length === 4 && t[2] === 'versions'))) return { ...base, kind:'resources', objectId:t[1], versionId:t[3] };
    if (t[0] === 'runs' && t.length === 2) return { ...base, kind:'runs', objectId:t[1] };
    return { kind:'invalid' };
  } catch { return { kind:'invalid' }; }
}
export function viewLocation(workspaceId:string, view:View, nodeId?:string):WorkspaceLocation { return view==='chat' ? (nodeId?{kind:'conversation',workspaceId,nodeId}:{kind:'conversations',workspaceId}) : {kind:view,workspaceId}; }
export interface RecentLocation { workspaceId:string; canonicalLocation:string; visitedAt:number }
const recentKey = 'rhiza:recent-locations:v1';
export function readRecents(storage:Pick<Storage,'getItem'>):RecentLocation[] {
  try {
    const raw:unknown=JSON.parse(storage.getItem(recentKey)??'[]'); if(!Array.isArray(raw)||raw.length>2000)return [];
    const counts=new Map<string,number>(),seen=new Set<string>();
    return raw.filter((item):item is RecentLocation=>{
      if(!item||typeof item.workspaceId!=='string'||typeof item.canonicalLocation!=='string'||!Number.isFinite(item.visitedAt)||Object.keys(item).some(key=>!['workspaceId','canonicalLocation','visitedAt'].includes(key)))return false;
      const parsed=parseLocation(item.canonicalLocation),count=counts.get(item.workspaceId)??0;
      if(parsed.workspaceId!==item.workspaceId||parsed.kind==='invalid'||formatLocation(parsed)!==item.canonicalLocation||seen.has(item.canonicalLocation)||count>=20)return false;
      counts.set(item.workspaceId,count+1);seen.add(item.canonicalLocation);return true;
    });
  } catch {return [];}
}
export function updateRecents(previous:RecentLocation[],location:WorkspaceLocation,now=Date.now()):RecentLocation[] {
  if(!location.workspaceId||['invalid','bootstrap','settings','chooser'].includes(location.kind))return previous;
  const canonicalLocation=formatLocation(location);
  return [{workspaceId:location.workspaceId,canonicalLocation,visitedAt:now},...previous.filter(item=>item.workspaceId===location.workspaceId&&item.canonicalLocation!==canonicalLocation).slice(0,19),...previous.filter(item=>item.workspaceId!==location.workspaceId)].slice(0,2000);
}
interface Entry {key:string;canonical:string;parent?:string}
export interface Restoration {scroll:number;anchorId?:string;offset?:number;focus?:string;graph?:unknown}
export function useWorkspaceNavigation() {
  const [location,setLocation]=useState(()=>parseLocation(window.location.hash));
  const [initialEntry]=useState<Entry>(()=>({key:crypto.randomUUID(),canonical:window.location.hash}));
  const entry=useRef(initialEntry);
  const restorations=useRef(new Map<string,Restoration>()),[entryKey,setEntryKey]=useState(initialEntry.key);
  const [restoration,setRestoration]=useState<Restoration>();
  const [canBack,setCanBack]=useState(false);
  const [recents,setRecents]=useState(()=>readRecents(localStorage));
  const capture=useCallback(()=>{
    const scroller=document.querySelector<HTMLElement>('.conversation, #workspace-main');
    const anchor=[...document.querySelectorAll<HTMLElement>('[id^="message-"]')].find(element=>element.getBoundingClientRect().bottom>(scroller?.getBoundingClientRect().top??0));
    restorations.current.set(entry.current.key,{...restorations.current.get(entry.current.key),scroll:scroller?.scrollTop??0,anchorId:anchor?.id,offset:anchor?.getBoundingClientRect().top,focus:document.activeElement?.getAttribute('aria-label')??undefined});
    while(restorations.current.size>50)restorations.current.delete(restorations.current.keys().next().value!);
  },[]);
  const navigate=useCallback((target:WorkspaceLocation,replace=false)=>{
    const canonical=formatLocation(target);if(!replace&&canonical===entry.current.canonical)return;
    capture();const next:Entry={key:replace?entry.current.key:crypto.randomUUID(),canonical,parent:replace?entry.current.parent:entry.current.canonical};
    window.history[replace?'replaceState':'pushState']({rhizaNavigation:next},'',canonical);entry.current=next;setEntryKey(next.key);setRestoration(restorations.current.get(next.key));setCanBack(!!next.parent);setLocation(target);
  },[capture]);
  useEffect(()=>{
    window.history.replaceState({rhizaNavigation:entry.current},'',window.location.href);
    const changed=()=>{const state=window.history.state?.rhizaNavigation as Entry|undefined;if(state?.key===entry.current.key&&state?.canonical===window.location.hash)return;capture();const next=state?.canonical===window.location.hash?state:{key:crypto.randomUUID(),canonical:window.location.hash};entry.current=next;setEntryKey(next.key);setRestoration(restorations.current.get(next.key));setCanBack(!!next.parent);setLocation(parseLocation(window.location.hash));};
    window.addEventListener('popstate',changed);window.addEventListener('hashchange',changed);return()=>{window.removeEventListener('popstate',changed);window.removeEventListener('hashchange',changed);};
  },[capture]);
  const close=useCallback((parent:WorkspaceLocation)=>{if(entry.current.parent?.startsWith('#/'))window.history.back();else navigate(parent,true);},[navigate]);
  const record=useCallback((target:WorkspaceLocation)=>setRecents(previous=>updateRecents(previous,target)),[]);
  const forget=useCallback((workspaceId:string,canonical?:string)=>setRecents(previous=>previous.filter(item=>item.workspaceId!==workspaceId||(canonical&&item.canonicalLocation!==canonical))),[]);
  useEffect(()=>{try{localStorage.setItem(recentKey,JSON.stringify(recents));}catch{/* Read navigation still works without persistent browser storage. */}},[recents]);
  const rememberGraph=useCallback((graph:unknown)=>{restorations.current.set(entry.current.key,{scroll:0,...restorations.current.get(entry.current.key),graph});},[]);
  return {location,entryKey,navigate,close,record,forget,recents,restoration,rememberGraph,canBack};
}
