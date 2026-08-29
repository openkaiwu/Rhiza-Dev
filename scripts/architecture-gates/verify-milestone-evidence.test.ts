import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  M01_COMMANDS,
  M01_PATHS,
  M02_COMMANDS,
  M02_FIXTURES,
  M02_PATHS,
  M03_FIXTURES,
  M03_PATHS,
  m03ObservedMetrics,
  M04_COMMANDS,
  M04_FIXTURES,
  M04_PATHS,
  m04ObservedMetrics,
  M05_COMMANDS,
  M05_FIXTURES,
  M05_PATHS,
  m05ObservedMetrics,
  validateEvidence,
  validateKnownExceptions,
  type MilestoneEvidence,
} from './verify-milestone-evidence';

describe('milestone evidence exceptions', () => {
  it('accepts an owned exception through its expiry day', () => {
    expect(() => validateKnownExceptions([{ owner: 'platform', expiry: '2026-08-23', adr_or_issue: 'INH-13', severity: 'blocking' }], new Date('2026-08-23T23:59:59Z'))).not.toThrow();
  });

  it('rejects an expired observational exception as blocking', () => {
    expect(() => validateKnownExceptions([{ owner: 'platform', expiry: '2000-01-01', adr_or_issue: 'INH-13', severity: 'observational' }], new Date('2026-08-23T00:00:00Z'))).toThrow('escalates to blocking');
  });
});

describe('milestone evidence validation', () => {
  const base = (): MilestoneEvidence => ({
    $schema: 'https://rhiza.dev/architecture-gates/milestone-evidence/1.0.0', schema_version: '1.0.0', milestone: 'M01', architecture_version: 'V4.0',
    commit: '0000000000000000000000000000000000000000', fixtures: [{ id: 'registry', path: 'docs/architecture-gates/fixture-registry.json', role: 'fixture_registry' }, { id: 'map', path: 'docs/architecture-gates/G0/characterization-map.json', role: 'characterization_map' }],
    commands: [{ command: 'pnpm run lint', result: 'pass' }], checksums: { 'docs/architecture-gates/fixture-registry.json': { algorithm: 'sha256', current: '0'.repeat(64), recorded_commit: '0'.repeat(64) }, 'docs/architecture-gates/G0/characterization-map.json': { algorithm: 'sha256', current: '0'.repeat(64), recorded_commit: '0'.repeat(64) } },
    failure_classification: { classification: 'none', rationale: 'pass' }, known_exceptions: [], environment: { node: 'v1', os: 'test', cpu: 'test', memory_bytes: 1 }, started_at: '2026-08-23T00:00:00.000Z', completed_at: '2026-08-23T00:00:01.000Z', result: 'pass',
  });

  it('rejects a missing recorded commit before accepting checksums', () => {
    expect(() => validateEvidence(base())).toThrow('recorded commit does not exist');
  });

  it('rejects non-passing command records', () => {
    const evidence = base(); evidence.commands[0].result = 'skipped';
    expect(() => validateEvidence(evidence)).toThrow('failing or skipped command');
  });

  it('rejects evidence labeled for a different milestone than requested', () => {
    const evidence = base(); evidence.milestone = 'M02';
    expect(() => validateEvidence(evidence, undefined, 'M01')).toThrow('does not match requested M01');
  });

  it('rejects an M03 manifest labeled with the historical V4.0 architecture version', () => {
    const evidence = base(); evidence.milestone = 'M03';
    evidence.severity = 'blocking'; evidence.thresholds = { required_gate_commands: 8 }; evidence.observed_metrics = { required_gate_commands: 8 };
    evidence.failure_injection_checkpoint = { checkpoint: 'test', injection_command: 'test', expected: 'test' }; evidence.recovery_command = 'test';
    expect(() => validateEvidence(evidence, undefined, 'M03')).toThrow('M03 architecture version V4.0 does not match V4.1');
  });

  it('rejects a reduced M01 command set', () => {
    expect(() => validateEvidence(base(), undefined, 'M01')).toThrow('M01 command set drift');
  });

  it('rejects a reduced M01 checksum path set', () => {
    const evidence = base();
    evidence.commands = M01_COMMANDS.map(command => ({ command, result: 'pass' }));
    expect(() => validateEvidence(evidence, undefined, 'M01')).toThrow('M01 checksum path set drift');
  });

  it('rejects arbitrary fixtures even when the M01 command and path sets are complete', () => {
    const evidence = base();
    evidence.commands = M01_COMMANDS.map(command => ({ command, result: 'pass' }));
    evidence.checksums = Object.fromEntries(M01_PATHS.map(path => [path, { algorithm: 'sha256' as const, current: '0'.repeat(64), recorded_commit: '0'.repeat(64) }]));
    expect(() => validateEvidence(evidence, undefined, 'M01')).toThrow('M01 fixture set drift');
  });

  it('configures M02 with the strict boundary gate and every named fixture checksummed', () => {
    expect(M02_COMMANDS).toContain('pnpm run verify:m02:boundaries');
    expect(M02_PATHS).toContain('scripts/architecture-gates/verify-m02-boundaries.ts');
    expect(M02_PATHS).toContain('server/application/create-application.ts');
    expect(M02_FIXTURES.every(fixture => M02_PATHS.includes(fixture.path))).toBe(true);
  });

  it('checksums M03 persistence, API, and stale-response coverage', () => {
    expect(M03_PATHS).toEqual(expect.arrayContaining([
      'e2e/postgres-migration.e2e.test.ts',
      'e2e/postgres-store.e2e.test.ts',
      'src/api.test.ts',
      'server/application/create-application.test.ts',
      'src/App.test.tsx',
      'server/index.ts',
      'src/components/Sidebar.tsx',
      'src/types.ts',
    ]));
  });

  it('requires M03 severity, explicit PostgreSQL skip metrics, and recovery evidence', () => {
    const evidence = base(); evidence.milestone = 'M03'; evidence.architecture_version = 'V4.1';
    expect(() => validateEvidence(evidence, undefined, 'M03')).toThrow(/severity|thresholds|observed_metrics|failure_injection_checkpoint|recovery_command/);
  });

  it('records the real PostgreSQL E2E result from the evidence environment', () => {
    expect(m03ObservedMetrics()).toMatchObject({ real_postgres_e2e: { status: 'skipped', reason: expect.stringContaining('DATABASE_URL') } });
    expect(m03ObservedMetrics('postgres://fixture')).toMatchObject({ real_postgres_e2e: { status: 'pass' } });
  });

  it('binds each M03 fixture identifier to its checksum and records an observed environment', () => {
    expect(M03_FIXTURES.every(fixture => M03_PATHS.includes(fixture.path))).toBe(true);
    const schema = JSON.parse(readFileSync('docs/architecture-gates/milestone-evidence.schema.json', 'utf8'));
    expect(schema.properties.environment.required).toEqual(expect.arrayContaining(['node', 'os', 'cpu', 'memory_bytes']));
  });

  it('configures M04 as a V4.2 blocking resource and minimal-host gate', () => {
    expect(M04_COMMANDS).toEqual(expect.arrayContaining(['pnpm run verify:m04:host-boundary', expect.stringContaining('e2e/resource-backfill.e2e.test.ts')]));
    expect(M04_PATHS).toEqual(expect.arrayContaining(['db/migrations/0006_resource_blob_host.up.sql', 'server/application/ports/host-runtime.ts', 'docs/architecture-gates/M04/resource-fixture.json']));
    expect(M04_FIXTURES.every(fixture => M04_PATHS.includes(fixture.path))).toBe(true);
    expect(m04ObservedMetrics()).toMatchObject({ committed_dangling_blob_refs: 0, digest_corruption_silent_fallbacks: 0, domain_application_os_imports: 0, current_host_contract: 'pass', real_postgres_e2e: { status: 'skipped' } });
  });

  it('requires M04 V4.2 severity and recovery evidence', () => {
    const evidence = base(); evidence.milestone = 'M04'; evidence.architecture_version = 'V4.2';
    expect(() => validateEvidence(evidence, undefined, 'M04')).toThrow(/command set drift|severity|thresholds/);
  });

  it('configures M05 as a V4.2 blocking transaction facts gate', () => {
    expect(M05_COMMANDS).toEqual(expect.arrayContaining([expect.stringContaining('e2e/m05-journal.e2e.test.ts')]));
    expect(M05_PATHS).toEqual(expect.arrayContaining(['db/migrations/0007_domain_journal_facts.up.sql', 'docs/adr/ADR-005-domain-event-catalog.md', 'docs/architecture-gates/M05/journal-fixture.json']));
    expect(M05_FIXTURES.every(fixture => M05_PATHS.includes(fixture.path))).toBe(true);
    expect(m05ObservedMetrics()).toMatchObject({ missing_semantic_events: 0, retry_100_new_events_after_first: 0, three_write_half_commits: 0, concurrent_duplicate_sequences: 0, backfill_checksum_drift: 0, activity_timeline: 'pass', real_postgres_e2e: { status: 'skipped' } });
  });

  it('rejects a reduced M02 command set', () => {
    const evidence = base();
    evidence.milestone = 'M02';
    expect(() => validateEvidence(evidence, undefined, 'M02')).toThrow('M02 command set drift');
  });

  it('rejects a reduced M02 checksum path set', () => {
    const evidence = base();
    evidence.milestone = 'M02';
    evidence.commands = M02_COMMANDS.map(command => ({ command, result: 'pass' }));
    expect(() => validateEvidence(evidence, undefined, 'M02')).toThrow('M02 checksum path set drift');
  });

  it('rejects arbitrary fixtures when the M02 command and path sets are complete', () => {
    const evidence = base();
    evidence.milestone = 'M02';
    evidence.commands = M02_COMMANDS.map(command => ({ command, result: 'pass' }));
    evidence.checksums = Object.fromEntries(M02_PATHS.map(path => [path, { algorithm: 'sha256' as const, current: '0'.repeat(64), recorded_commit: '0'.repeat(64) }]));
    expect(() => validateEvidence(evidence, undefined, 'M02')).toThrow('M02 fixture set drift');
  });

  it('rejects an M02 manifest that invents an exception', () => {
    const evidence = base();
    evidence.milestone = 'M02';
    evidence.commands = M02_COMMANDS.map(command => ({ command, result: 'pass' }));
    evidence.checksums = Object.fromEntries(M02_PATHS.map(path => [path, { algorithm: 'sha256' as const, current: '0'.repeat(64), recorded_commit: '0'.repeat(64) }]));
    evidence.fixtures = M02_FIXTURES;
    evidence.failure_classification = { classification: 'known_exception', rationale: 'invented waiver' };
    evidence.known_exceptions = [{ owner: 'unknown', expiry: '2099-01-01', adr_or_issue: 'NONE', severity: 'observational' }];
    expect(() => validateEvidence(evidence, undefined, 'M02')).toThrow('M02 failure classification drift');
  });

  const valid = (): MilestoneEvidence => {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const checksum = (path: string) => createHash('sha256').update(execFileSync('git', ['show', `${commit}:${path}`])).digest('hex');
    const registry = checksum('docs/architecture-gates/fixture-registry.json');
    const map = checksum('docs/architecture-gates/G0/characterization-map.json');
    return {
      ...base(), commit,
      checksums: {
        'docs/architecture-gates/fixture-registry.json': { algorithm: 'sha256', current: registry, recorded_commit: registry },
        'docs/architecture-gates/G0/characterization-map.json': { algorithm: 'sha256', current: map, recorded_commit: map },
      },
    };
  };

  it('rejects a recorded commit that is not an ancestor of the supplied HEAD', () => {
    const parent = execFileSync('git', ['rev-parse', 'HEAD^'], { encoding: 'utf8' }).trim();
    expect(() => validateEvidence(valid(), parent)).toThrow('not an ancestor');
  });

  it('rejects a checksum that is not bound to the recorded commit', () => {
    const evidence = valid();
    evidence.checksums['docs/architecture-gates/fixture-registry.json'].recorded_commit = '0'.repeat(64);
    expect(() => validateEvidence(evidence)).toThrow('recorded commit checksum drift');
  });

  it('rejects checksum paths that escape the repository', () => {
    const evidence = valid();
    evidence.checksums = { '../outside.json': evidence.checksums['docs/architecture-gates/fixture-registry.json'], ...evidence.checksums };
    expect(() => validateEvidence(evidence)).toThrow('unsafe checksum path');
  });

  it('accepts historical evidence when the current checkout has drifted', () => {
    const path = 'docs/architecture-gates/fixture-registry.json';
    const original = readFileSync(path);
    try {
      writeFileSync(path, `${original.toString()}\n`);
      expect(() => validateEvidence(valid())).not.toThrow();
    } finally {
      writeFileSync(path, original);
    }
  });

  it('rejects historical evidence in strict-current mode when the checkout has drifted', () => {
    const path = 'docs/architecture-gates/fixture-registry.json';
    const original = readFileSync(path);
    try {
      writeFileSync(path, `${original.toString()}\n`);
      expect(() => validateEvidence(valid(), undefined, undefined, { strictCurrent: true })).toThrow('current checksum drift');
    } finally {
      writeFileSync(path, original);
    }
  });
});
