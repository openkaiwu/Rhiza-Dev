import { expect, it } from 'vitest';
import { RunTraceBuffer, TransientStreamSink } from './run';

it('backpressures trace writes and bounds the transient ring at 256 events', async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let stored = 0;
  const stream = new TransientStreamSink<{ sequence: number }>(() => undefined);
  const trace = new RunTraceBuffer(async batch => { await held; stored += batch.length; });
  const at = new Date('2026-01-01T00:00:00.000Z').toISOString();
  for (let index = 0; index < 127; index++) await trace.push('CONTENT_DELTA', at);
  let flushed = false;
  const pending = trace.push('CONTENT_DELTA', at).then(() => { flushed = true; });
  await Promise.resolve();
  expect(flushed).toBe(false);
  release();
  await pending;
  for (let index = 128; index < 10000; index++) await trace.push('CONTENT_DELTA', at);
  await trace.flush();
  expect(stored).toBe(10000);
  for (let sequence = 1; sequence <= 10000; sequence++) await stream.publish({ sequence });
  expect(stream.recent).toHaveLength(256);
  expect(stream.recent[0].sequence).toBe(9745);
});

it('rejects unknown runtime event types before trace persistence', async () => {
  const writes: unknown[] = [];
  const trace = new RunTraceBuffer(async batch => { writes.push(...batch); });
  await expect(trace.push('provider response body', new Date().toISOString())).rejects.toThrow('RUN_TRACE_TYPE_INVALID');
  await expect(trace.push('RUN_END', 'provider response body')).rejects.toThrow('RUN_TRACE_TIMESTAMP_INVALID');
  await trace.flush();
  expect(trace.count).toBe(0);
  expect(writes).toEqual([]);
});
