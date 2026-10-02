import { applySemanticChanges } from '../server/domain-journal';
import type { PostgresWorkspaceStore } from '../server/postgres-store';
import { semanticChecksum, semanticStateChecksum } from '../server/infrastructure/workspace-semantic-checksum';
import { validatePortableHistory } from '../server/application/portable-history';
import type { PortableWorkspaceFacts } from '../server/application/ports/portable-workspace';

/** Live Journal may append transaction checksums after a Purge redaction overlay. */
function persistedJournalChecksum(facts: PortableWorkspaceFacts): string {
  const snapshot = facts.journal[0]?.payload.snapshot as { state?: Record<string, unknown> } | undefined;
  if (!snapshot?.state) throw new Error('M10_JOURNAL_BASELINE_MISSING');
  const state = structuredClone(snapshot.state);
  for (const [index, event] of facts.journal.entries()) {
    if (event.payload.stateChanges) applySemanticChanges(state, event.payload.stateChanges as Record<string, unknown>);
    const portable = event.payload.portableStateChecksum;
    const finalInCommand = facts.journal[index + 1]?.commandId !== event.commandId;
    const checksum = portable ?? (finalInCommand ? event.payload.reconcileChecksum ?? event.payload.checksum : undefined);
    if ((portable !== undefined || finalInCommand) && (typeof checksum !== 'string' || checksum !== semanticStateChecksum(state))) throw new Error('M10_JOURNAL_CHECKSUM_MISMATCH');
  }
  // Reuse shape/final-state validation; Bundle's untrusted checksum rules stay strict.
  const journal = facts.journal.map(event => ({ ...event, payload: Object.fromEntries(Object.entries(event.payload).filter(([key]) => key !== 'portableStateChecksum')) }));
  return validatePortableHistory({ ...facts, journal }, semanticStateChecksum);
}

export interface M10WorkspaceCheck {
  workspaceId: string;
  match: boolean;
  currentChecksum?: string;
  journalChecksum?: string;
  error?: string;
  counts?: { messages: number; manifests: number; versions: number; runs: number; journal: number };
}

/** Offline read-only reconciliation; never seed or backfill a failing Workspace. */
export async function inspectM10Store(store: PostgresWorkspaceStore) {
  const workspaces: M10WorkspaceCheck[] = [];
  for (const workspaceId of await store.listWorkspaceIds()) {
    const scoped = store.forWorkspace(workspaceId) as PostgresWorkspaceStore;
    try {
      const current = await scoped.readExisting();
      if (!current) throw new Error('M10_WORKSPACE_DATA_MISSING');
      if (!(await scoped.readJournal(1)).length) throw new Error('M10_JOURNAL_BASELINE_MISSING');
      const facts = await scoped.readPortableWorkspace();
      const currentChecksum = semanticChecksum(current);
      const journalChecksum = persistedJournalChecksum(facts);
      workspaces.push({ workspaceId, currentChecksum, journalChecksum, match: currentChecksum === journalChecksum,
        counts: { messages: facts.workspace.messages.length, manifests: facts.workspace.manifests.length,
          versions: facts.workspace.resourceVersions.length, runs: facts.runs.length, journal: facts.journal.length } });
    } catch (error) {
      const candidate = error as { code?: string; message?: string };
      const code = candidate.code ?? candidate.message;
      workspaces.push({ workspaceId, match: false, error: code && /^(M10|BUNDLE|CONTENT|JOURNAL)_[A-Z_]+$/.test(code) ? code : 'M10_RECONCILIATION_FAILED' });
    }
  }
  const plaintext = await store.auditLegacyPlaintextReplicas();
  const keys = await store.auditHistoricalKeys();
  const unhealthyKeys = Object.values(keys).flat().filter(key => key.referenced && key.state !== 'active').length;
  const provenance = await store.auditProvenanceCoverage();
  const purge = await store.auditPurgeCompletion();
  return { schemaVersion: '1.0.0', ok: workspaces.length > 0 && workspaces.every(item => item.match)
    && Object.values(plaintext).every(count => count === 0) && unhealthyKeys === 0
    && provenance.missing === 0 && provenance.broken === 0 && provenance.invalid === 0
    && purge.pending === 0 && purge.unrevokedReferences === 0,
  workspaces, plaintext, unhealthyKeys, provenance, purge };
}
