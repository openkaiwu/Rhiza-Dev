export type LegacyWriteEntry = 'relational.update' | 'uow.missing-command' | 'uow.missing-transaction' | 'json.fixture.update';
const counters = new Map<LegacyWriteEntry, number>();
const startedAt = new Date().toISOString();

/** Never accept payloads: the observation boundary records only entry and count. */
export function observeLegacyWrite(entry: LegacyWriteEntry): void {
  counters.set(entry, (counters.get(entry) ?? 0) + 1);
}

export function legacyWriteReport() {
  return { schemaVersion: '1.0.0', window: 'current-process', startedAt,
    entries: (['relational.update', 'uow.missing-command', 'uow.missing-transaction', 'json.fixture.update'] as const)
      .map(entry => ({ entry, operation: entry === 'json.fixture.update' ? 'fixture' : 'rejected', count: counters.get(entry) ?? 0 })) };
}
