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
