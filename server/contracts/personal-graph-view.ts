import type { ActorRef } from './references';

export interface GraphViewPosition { objectType: 'conversation' | 'segment' | 'message' | 'resource' | 'run'; objectId: string; x: number; y: number; collapsed: boolean }
export interface GraphViewPresentation {
  viewport: { x: number; y: number; zoom: number };
  filters: { objectTypes: string[]; relationTypes: string[] };
}
export interface SavePersonalGraphView extends GraphViewPresentation { viewType: string; expectedRevision: number; positions: GraphViewPosition[] }
export interface PersonalGraphViewReceipt { viewType: string; ownerScope: { scopeType: 'user'; scopeId: string }; revision: number }
export interface PersonalGraphView extends PersonalGraphViewReceipt, GraphViewPresentation { source: 'default' | 'personal'; positions: GraphViewPosition[] }

export function graphViewError(code: string, status = 400) { return Object.assign(new Error(code), { code, status }); }
export function validateGraphViewOwner(actor: ActorRef) {
  if (actor?.actorType !== 'human' || typeof actor.actorId !== 'string' || !actor.actorId || actor.actorId.length > 200) throw graphViewError('GRAPH_VIEW_USER_REQUIRED', 403);
}
export function validateGraphViewType(viewType: string) {
  if (typeof viewType !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(viewType)) throw graphViewError('INVALID_GRAPH_VIEW');
}
const objectTypes = ['conversation', 'segment', 'message', 'resource', 'run'];
const relationTypes = ['derived_from', 'references', 'related_to', 'merged_into', 'contains'];
function hasOnly(value: unknown, keys: string[]): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)));
}
export function validatePersonalGraphView(input: SavePersonalGraphView) {
  validateGraphViewType(input?.viewType);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision >= 2147483647 || !Array.isArray(input.positions) || input.positions.length > 1000) throw graphViewError('INVALID_GRAPH_VIEW');
  const seen = new Set<string>();
  for (const position of input.positions) {
    if (!hasOnly(position, ['objectType', 'objectId', 'x', 'y', 'collapsed']) || !objectTypes.includes(position.objectType)
      || typeof position.objectId !== 'string' || !position.objectId || position.objectId.length > 128
      || !Number.isSafeInteger(position.x) || !Number.isSafeInteger(position.y) || Math.abs(position.x) > 1_000_000 || Math.abs(position.y) > 1_000_000
      || typeof position.collapsed !== 'boolean') throw graphViewError('INVALID_GRAPH_VIEW_POSITION');
    const key = `${position.objectType}:${position.objectId}`;
    if (seen.has(key)) throw graphViewError('DUPLICATE_GRAPH_VIEW_POSITION');
    seen.add(key);
  }
  const viewport = input.viewport;
  if (!hasOnly(viewport, ['x', 'y', 'zoom']) || !Number.isFinite(viewport.x) || !Number.isFinite(viewport.y)
    || Math.abs(viewport.x) > 1_000_000 || Math.abs(viewport.y) > 1_000_000 || !Number.isFinite(viewport.zoom) || viewport.zoom < 0.05 || viewport.zoom > 5) throw graphViewError('INVALID_GRAPH_VIEWPORT');
  const filters = input.filters;
  if (!hasOnly(filters, ['objectTypes', 'relationTypes']) || !Array.isArray(filters.objectTypes) || !Array.isArray(filters.relationTypes)
    || filters.objectTypes.length > objectTypes.length || filters.relationTypes.length > relationTypes.length
    || filters.objectTypes.some(value => !objectTypes.includes(value)) || filters.relationTypes.some(value => !relationTypes.includes(value))) throw graphViewError('INVALID_GRAPH_VIEW_FILTERS');
}
