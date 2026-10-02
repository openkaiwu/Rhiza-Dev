// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { runMilestoneChecks } from './milestone-checks';

const scripts = (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts;
const passed = () => ({ status: 0, signal: null });

it('reports engineering success without claiming formal Gate acceptance', () => {
  const result = runMilestoneChecks('m15', { scripts, run: passed, fileExists: () => true });
  expect(result.exitCode).toBe(0);
  expect(result.report).toMatchObject({ milestone: 'm15', scope: 'engineering_checks', ok: true, formalGate: { status: 'pending' } });
  expect(result.report.checks.every(check => check.status === 'passed')).toBe(true);
  expect(result.report.formalGate.unverified.length).toBeGreaterThan(0);
});

it('retains a failed recorded M17 performance check and runs remaining checks without benchmarking', () => {
  const run = vi.fn((args: string[]) => ({ status: args.includes('m17:performance:status') ? 1 : 0, signal: null }));
  const result = runMilestoneChecks('m17', { scripts, run, fileExists: () => true });
  expect(result.exitCode).toBe(1);
  expect(result.report.ok).toBe(false);
  expect(result.report.checks.find(check => check.id === 'performance')).toMatchObject({ status: 'failed', exitCode: 1 });
  expect(run.mock.calls.flat(2)).not.toContain('benchmark:m17');
  expect(result.report.checks.some(check => check.status === 'passed')).toBe(true);
  expect(result.report.formalGate.unverified).toContain('production_full_storage_and_fault_recovery');
  expect(result.report.formalGate.unverified).toContain('comparable_g0_performance_baseline');
});

it('fails a missing package check without dispatching it or suppressing other results', () => {
  const available = { ...scripts };
  delete available['m16:collaboration:checks'];
  const run = vi.fn(passed);
  const result = runMilestoneChecks('m16', { scripts: available, run, fileExists: () => true });
  expect(result.exitCode).toBe(1);
  expect(result.report.checks.find(check => check.id === 'collaboration')).toMatchObject({ status: 'missing', exitCode: null, error: 'MISSING_SCRIPT:m16:collaboration:checks' });
  expect(run.mock.calls.flat(2)).not.toContain('m16:collaboration:checks');
  expect(result.report.checks.some(check => check.status === 'passed')).toBe(true);
});

it.each([
  ['m15', 'e2e/m15-context.e2e.test.ts', 'context'],
  ['m15', 'e2e/m15-resource-version.e2e.test.ts', 'resource_versions'],
  ['m17', 'e2e/m17-storage-faults.e2e.test.ts', 'storage_faults'],
])('fails %s missing test input %s before Vitest can silently select only the remaining files', (milestone, missing, checkId) => {
  const run = vi.fn(passed);
  const result = runMilestoneChecks(milestone, { scripts, run, fileExists: file => file !== missing });
  expect(result.exitCode).toBe(1);
  expect(result.report.checks.find(check => check.id === checkId)).toMatchObject({ status: 'missing', error: `MISSING_FILE:${missing}` });
  expect(run.mock.calls.flat(2)).not.toContain(missing);
});

it.each([
  { status: null, signal: null, error: new Error('spawn unavailable') },
  { status: 0, signal: 'SIGTERM' },
  { status: null, signal: null },
])('does not accept failed startup or termination as a passing check: %j', outcome => {
  const result = runMilestoneChecks('m18', { scripts, run: () => outcome, fileExists: () => true });
  expect(result.exitCode).toBe(1);
  expect(result.report.checks.every(check => check.status === 'failed')).toBe(true);
});

it('reports a thrown child-process failure and still evaluates subsequent checks', () => {
  const run = vi.fn(passed).mockImplementationOnce(() => { throw new Error('spawn failure'); });
  const result = runMilestoneChecks('m18', { scripts, run, fileExists: () => true });
  expect(result.exitCode).toBe(1);
  expect(result.report.checks[0]).toMatchObject({ status: 'failed', error: 'CHECK_PROCESS_ERROR' });
  expect(result.report.checks.some(check => check.status === 'passed')).toBe(true);
});

it('refuses unknown milestones instead of returning an empty passing report', () => {
  const run = vi.fn(passed);
  const result = runMilestoneChecks('m19', { scripts, run, fileExists: () => true });
  expect(result.exitCode).toBe(1);
  expect(result.report).toMatchObject({ ok: false, error: 'UNKNOWN_MILESTONE' });
  expect(run).not.toHaveBeenCalled();
});

it('emits one CLI JSON report, keeps child logs on stderr, and exits nonzero for recorded performance failure', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'rhiza-checks-runner-'));
  try {
    // Only the child command boundary is stubbed; no existing checks execute.
    writeFileSync(join(fixture, 'pnpm'), '#!/bin/sh\necho child-check-log\nif [ "$2" = "m17:performance:status" ]; then exit 1; fi\nexit 0\n', { mode: 0o755 });
    const child = spawnSync(process.execPath, ['--import', 'tsx', resolve('scripts/milestone-checks.ts'), 'm17'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${fixture}:${process.env.PATH ?? ''}` }, timeout: 10000,
    });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(1);
    const report = JSON.parse(child.stdout);
    expect(report).toMatchObject({ milestone: 'm17', ok: false, formalGate: { status: 'pending' } });
    expect(report.checks.find((check: { id: string }) => check.id === 'performance')).toMatchObject({ status: 'failed', exitCode: 1 });
    expect(report.checks.filter((check: { status: string }) => check.status === 'passed')).toHaveLength(4);
    expect(report.checks.find((check: { id: string }) => check.id === 'storage_faults')).toMatchObject({ status: 'passed', command: ['pnpm', 'exec', 'vitest', 'run', 'e2e/m17-storage-faults.e2e.test.ts', '--maxWorkers=1', '--testTimeout=30000'] });
    expect(child.stderr).toContain('child-check-log');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
