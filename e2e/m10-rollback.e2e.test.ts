// @vitest-environment node
import { expect, it } from 'vitest';
import { runRollbackDrill } from '../scripts/m10-rollback-drill';

it('preserves new history, attachment identity and receipts across a schema-compatible code rollback without resurrecting Purged content', async () => {
  const report = await runRollbackDrill('1145401');
  expect(report.ok).toBe(true);
  expect(report.compatibleReader).toBe(true);
  expect(report.recoveredWithoutDuplicateCall).toBe(true);
  expect(report.purgedContentAbsent).toBe(true);
  expect(report.workspaces).toBe(2);
}, 90_000);
