// @vitest-environment node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('restores two isolated Workspaces from encrypted recovery archives after an activation interruption, without repeating model calls', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/m16-restore-drill.ts'], { timeout: 60000 }).catch(error => { throw new Error(error.stdout || error.message); });
  const report = JSON.parse(stdout);
  expect(report).toMatchObject({
    schemaVersion: '1.0.0', ok: true, workspaces: 2, checksumMismatches: 0,
    interruptedPhase: 'blobs-ready', recoveredWithoutUpload: true,
    duplicateIngestions: 0, restoreModelCalls: 0, corruptArchiveRejected: true,
    originalDataUnchanged: true, reconciliationPassed: true,
    continuedConversation: true, continuedModelCalls: 1,
    managedBackup: 'passed', managedBackupCount: 1, managedBackupPinned: true, externalAcceptance: 'pending',
  });
  expect(report.counts.messages).toBeGreaterThanOrEqual(8);
  expect(report.counts.manifests).toBeGreaterThanOrEqual(4);
  expect(report.counts.resourceVersions).toBeGreaterThanOrEqual(2);
  expect(report.counts.collaborations).toBe(1);
  expect(report.counts.provenance).toBeGreaterThanOrEqual(4);
  expect(report.counts.journal).toBeGreaterThan(2);
  console.info(`M16_RESTORE_REPORT ${JSON.stringify(report)}`);
}, 65000);
