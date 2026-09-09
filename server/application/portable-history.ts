import type { PortableWorkspaceFacts } from './ports/portable-workspace';
import { workspaceSemanticSnapshot } from '../domain-journal';
import { bundleError } from '../domain/portable-bundle';

/** Reconcile the portable baseline and tail with the portable current state before activation. */
export function validatePortableHistory(facts: PortableWorkspaceFacts, hash: (state: Record<string, unknown>) => string): string {
  const expected = workspaceSemanticSnapshot(facts.workspace);
  const keys = new Set(Object.keys(expected));
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  const validTypes = (value: Record<string, unknown>) => Object.entries(value).every(([key, item]) => {
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
  if (Object.keys(snapshot.state).length !== keys.size || Object.keys(snapshot.state).some(key => !keys.has(key))) throw bundleError('BUNDLE_INVALID_BASELINE');
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
    Object.assign(state, changes);
    verifyChecksum(event.payload);
  }
  const checksum = hash(state);
  if (checksum !== hash(expected)) throw bundleError('BUNDLE_HISTORY_MISMATCH');
  return checksum;
}
