import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function evaluateM17Performance(report: unknown, matrix: unknown) {
  try {
    const observed = report as { profile: { warmup_count: number; sample_count: number; concurrency: number; external_network: boolean }; metrics: Record<string, { samples_ms: number[]; trace_count?: number }> };
    const expected = (matrix as { performance: { commandMs: { p95Max: number; p99Max: number }; graphMs: { p95Max: number; p99Max: number }; contextMs: { p95Max: number }; traceRegressionPercentMax: number; profile: { warmups: number; samples: number; concurrency: number; externalNetwork: boolean } } }).performance;
    const validProfile = observed.profile.warmup_count === expected.profile.warmups && observed.profile.sample_count === expected.profile.samples
      && observed.profile.concurrency === expected.profile.concurrency && observed.profile.external_network === expected.profile.externalNetwork;
    const percentile = (name: string, percent: number) => {
      const samples = observed.metrics[name].samples_ms;
      if (!Array.isArray(samples) || samples.length !== expected.profile.samples || samples.some(value => !Number.isFinite(value) || value < 0)) throw new Error('INVALID_PERFORMANCE_SAMPLES');
      return [...samples].sort((a,b) => a-b)[Math.ceil(samples.length * percent / 100) - 1];
    };
    const command = { p95: percentile('command',95), p99: percentile('command',99) };
    const graph = { p95: percentile('graph',95), p99: percentile('graph',99) };
    const context = { p95: percentile('context',95) };
    const traceRegression = (percentile('tracePrimary',95) / command.p95 - 1) * 100;
    const thresholds = [expected.commandMs.p95Max,expected.commandMs.p99Max,expected.graphMs.p95Max,expected.graphMs.p99Max,expected.contextMs.p95Max,expected.traceRegressionPercentMax];
    if (thresholds.some(value => !Number.isFinite(value) || value <= 0)) throw new Error('INVALID_PERFORMANCE_THRESHOLDS');
    const assertions = { frozen_profile: validProfile, command_p95: command.p95 <= expected.commandMs.p95Max, command_p99: command.p99 <= expected.commandMs.p99Max,
      graph_p95: graph.p95 <= expected.graphMs.p95Max, graph_p99: graph.p99 <= expected.graphMs.p99Max, context_p95: context.p95 <= expected.contextMs.p95Max,
      trace_count: observed.metrics.tracePrimary.trace_count === 10000, trace_regression: Number.isFinite(traceRegression) && traceRegression <= expected.traceRegressionPercentMax };
    return { schemaVersion: '1.0.0', ok: Object.values(assertions).every(Boolean), assertions, metrics: { command,graph,context,traceRegression }, g0Relative: 'pending' };
  } catch { return { schemaVersion: '1.0.0', ok: false, error: 'INVALID_PERFORMANCE_EVIDENCE', assertions: { trace_regression: false } }; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = JSON.parse(await readFile('reports/m15-m18/performance.json','utf8'));
    const matrix = JSON.parse(await readFile('reports/m15-m18/m17-matrix.json','utf8'));
    const result = evaluateM17Performance(report,matrix);
    await writeFile('reports/m15-m18/performance-status.json', JSON.stringify(result,null,2) + '\n');
    console.info(JSON.stringify(result)); if (!result.ok) process.exitCode = 1;
  } catch { console.error(JSON.stringify({ ok: false, error: 'PERFORMANCE_EVIDENCE_UNAVAILABLE' })); process.exitCode = 1; }
}
