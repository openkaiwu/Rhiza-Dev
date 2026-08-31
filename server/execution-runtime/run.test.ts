import { expect, it } from 'vitest';
import { RunTraceBuffer, TransientStreamSink } from './run';

it('backpressures trace writes and bounds the transient ring at 256 events', async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let stored = 0;
  const stream = new TransientStreamSink<{ sequence: number }>(() => undefined);
  const trace = new RunTraceBuffer(async batch => { await held; stored += batch.length; });
  for (let index = 0; index < 127; index++) await trace.push('CONTENT_DELTA', 'now');
  let flushed = false;
  const pending = trace.push('CONTENT_DELTA', 'now').then(() => { flushed = true; });
  await Promise.resolve();
  expect(flushed).toBe(false);
  release();
  await pending;
  for (let index = 128; index < 10000; index++) await trace.push('CONTENT_DELTA', 'now');
  await trace.flush();
  expect(stored).toBe(10000);
  for (let sequence = 1; sequence <= 10000; sequence++) await stream.publish({ sequence });
  expect(stream.recent).toHaveLength(256);
  expect(stream.recent[0].sequence).toBe(9745);
});
