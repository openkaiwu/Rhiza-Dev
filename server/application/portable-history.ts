import { applySemanticChanges } from '../domain-journal';
import type { PortableWorkspaceFacts } from './ports/portable-workspace';
import type { DomainEventEnvelope } from '../domain-journal';
import { workspaceSemanticSnapshot } from '../domain-journal';
import { bundleError } from '../domain/portable-bundle';

/** Reconcile the portable baseline and tail with the portable current state before activation. */
export function validatePortableHistory(facts: PortableWorkspaceFacts, hash: (state: Record<string, unknown>) => string): string {
  const expected = workspaceSemanticSnapshot(facts.workspace);
  const keys = new Set([...Object.keys(expected),'defaultModelId']);
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  const validTypes = (value: Record<string, unknown>) => Object.entries(value).every(([key, item]) => {
    if (key === 'defaultModelId') return item === null || typeof item === 'string';
    const target = expected[key];
    if (Array.isArray(target)) {
      if (!Array.isArray(item)) return false;
      const ids = new Set<string>();
      return item.every(entry => {
        if (!record(entry) || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) return false;
        ids.add(entry.id);
        return true;
      });
    }
    return record(target) ? record(item) : typeof item === typeof target && item !== null;
  });
  const first = facts.journal[0];
  const snapshot = first?.payload.snapshot;
  if (!record(snapshot) || snapshot.stateSchema !== 'rhiza.workspace-semantic.v1' || !record(snapshot.state)) throw bundleError('BUNDLE_INVALID_BASELINE');
  if (Object.keys(snapshot.state).filter(key => key !== 'defaultModelId').length !== Object.keys(expected).filter(key => key !== 'defaultModelId').length || Object.keys(snapshot.state).some(key => !keys.has(key))) throw bundleError('BUNDLE_INVALID_BASELINE');
  if (!validTypes(snapshot.state)) throw bundleError('BUNDLE_INVALID_BASELINE');
  const state = structuredClone(snapshot.state);
  const hasPortableChecksums = facts.journal.some(event => event.payload.portableStateChecksum !== undefined);
  const verifyChecksum = (payload: Record<string, unknown>) => {
    if (hasPortableChecksums && payload.portableStateChecksum === undefined) throw bundleError('BUNDLE_EVENT_CHECKSUM_MISSING');
    if (hasPortableChecksums && payload.portableStateChecksum !== hash(state)) throw bundleError('BUNDLE_EVENT_STATE_MISMATCH');
  };
  verifyChecksum(first.payload);
  for (const event of facts.journal.slice(1)) {
    if (event.payload.snapshot !== undefined) throw bundleError('BUNDLE_UNEXPECTED_BASELINE');
    const changes = event.payload.stateChanges;
    if (changes === undefined) { verifyChecksum(event.payload); continue; }
    if (!record(changes) || Object.keys(changes).some(key => !keys.has(key)) || !validTypes(changes)) throw bundleError('BUNDLE_INVALID_HISTORY_DELTA');
    applySemanticChanges(state, changes);
    verifyChecksum(event.payload);
  }
  const checksum = hash(state);
  if (checksum !== hash(expected)) throw bundleError('BUNDLE_HISTORY_MISMATCH');
  return checksum;
}

/** Rebuild a replayable history without entities removed by an authorized Purge. */
export function redactPortableHistory(
  events: DomainEventEnvelope[], before: Record<string, unknown>, after: Record<string, unknown>,
  hash: (state: Record<string, unknown>) => string,
): Array<{ eventId: string; payload: Record<string, unknown> }> {
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  const removed = new Map<string, Set<string>>();
  const replacements = new Map<string, Map<string, { id: string }>>();
  for (const [key, value] of Object.entries(before)) {
    if (!Array.isArray(value) || !Array.isArray(after[key])) continue;
    const remaining = new Map((after[key] as Array<{ id: string }>).map(item => [item.id, item]));
    removed.set(key, new Set((value as Array<{ id: string }>).filter(item => !remaining.has(item.id)).map(item => item.id)));
    replacements.set(key, new Map((value as Array<{ id: string }>).flatMap(item => {
      const current = remaining.get(item.id);
      return current && JSON.stringify(item) !== JSON.stringify(current) ? [[item.id, current] as const] : [];
    })));
  }
  const scrub = (source: Record<string, unknown>) => Object.fromEntries(Object.entries(source).map(([key, value]) => {
    if (Array.isArray(value)) return [key, value.filter(item => !removed.get(key)?.has((item as { id?: string }).id ?? ''))
      .map(item => replacements.get(key)?.get((item as { id?: string }).id ?? '') ?? item)];
    if (key === 'activeNodeId' && removed.get('nodes')?.has(String(value))) return [key, after.activeNodeId];
    return [key, value];
  }));
  let source: Record<string, unknown> | undefined;
  let prior: Record<string, unknown> | undefined;
  const result: Array<{ eventId: string; payload: Record<string, unknown> }> = [];
  const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
  const timestamp = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value);
  const safeRelation = (value: unknown) => {
    if (!record(value) || !uuid(value.id) || !uuid(value.source) || !uuid(value.target)
      || !['derived-from', 'references', 'related-to', 'merged-into'].includes(String(value.relation))
      || !timestamp(value.createdAt)) return undefined;
    return { id: value.id, source: value.source, target: value.target, relation: value.relation, createdAt: value.createdAt, label: '' };
  };
  for (const event of events) {
    if (!source) {
      const snapshot = event.payload.snapshot as { stateSchema?: string; state?: Record<string, unknown> } | undefined;
      if (snapshot?.stateSchema !== 'rhiza.workspace-semantic.v1' || !snapshot.state) {
        throw Object.assign(new Error('Purge requires a replayable Journal baseline'), { code: 'PURGE_JOURNAL_BASELINE_MISSING', status: 409 });
      }
      source = structuredClone(snapshot.state);
    } else if (event.payload.stateChanges) {
      applySemanticChanges(source, event.payload.stateChanges as Record<string, unknown>);
    }
    const state = scrub(source);
    const previousState = prior;
    const changes = previousState ? { ...Object.fromEntries(Object.entries(state).filter(([key, value]) => JSON.stringify(previousState[key]) !== JSON.stringify(value))), ...(previousState.defaultModelId && !state.defaultModelId ? { defaultModelId:null } : {}) } : undefined;
    const payload: Record<string, unknown> = prior
      ? { stateChanges: changes, portableStateChecksum: hash(state), redacted: true }
      : { snapshot: { stateSchema: 'rhiza.workspace-semantic.v1', sourceSequence: 0, state }, portableStateChecksum: hash(state), redacted: true };
    if (event.eventType === 'object.purged') {
      const object = event.payload.removedObject;
      if (record(object) && uuid(object.id) && (object.kind === 'main' || object.kind === 'branch')
        && timestamp(object.createdAt) && typeof object.x === 'number' && typeof object.y === 'number') {
        payload.removedObject = { id: object.id, kind: object.kind, createdAt: object.createdAt, x: object.x, y: object.y };
      }
      if (Array.isArray(event.payload.removedRelations)) payload.removedRelations = event.payload.removedRelations.map(safeRelation).filter(Boolean);
    }
    if (event.eventType === 'graph.relation.removed' && event.payload.removedRelation) {
      payload.removedRelation = safeRelation(event.payload.removedRelation);
    }
    result.push({ eventId: event.eventId, payload });
    prior = state;
  }
  if (events.length && (!prior || hash(prior) !== hash(after))) {
    throw Object.assign(new Error('Purge Journal cannot reconcile with current state'), { code: 'PURGE_JOURNAL_RECONCILE_MISMATCH', status: 409 });
  }
  return result;
}
