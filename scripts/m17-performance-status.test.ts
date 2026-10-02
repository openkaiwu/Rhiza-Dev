// @vitest-environment node
import { expect, it } from 'vitest';
import { evaluateM17Performance } from './m17-performance-status';

it('recomputes frozen budgets from raw samples instead of trusting an ok flag', () => {
  const samples = (ms: number) => Array.from({ length: 200 }, () => ms);
  const matrix = { performance: { commandMs: { p95Max: 200, p99Max: 500 }, graphMs: { p95Max: 150, p99Max: 400 }, contextMs: { p95Max: 250 }, traceRegressionPercentMax: 25, profile: { warmups: 20, samples: 200, concurrency: 1, externalNetwork: false } } };
  const report = { ok: true, profile: { warmup_count: 20, sample_count: 200, concurrency: 1, external_network: false }, metrics: { command: { samples_ms: samples(406) }, graph: { samples_ms: samples(20) }, context: { samples_ms: samples(7) }, tracePrimary: { samples_ms: samples(410), trace_count: 10000 } } };
  expect(evaluateM17Performance(report, matrix)).toMatchObject({ ok: false, assertions: { command_p95: false, command_p99: true, graph_p95: true } });
  report.metrics.command.samples_ms = samples(100);
  expect(evaluateM17Performance(report,matrix).assertions.trace_regression).toBe(false);
  report.metrics.tracePrimary.samples_ms = samples(110);
  expect(evaluateM17Performance(report,matrix).ok).toBe(true);
  report.metrics.context.samples_ms.pop(); expect(evaluateM17Performance(report,matrix).ok).toBe(false);
});
