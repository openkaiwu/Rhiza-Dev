// @vitest-environment node
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import { exportSecurityFixture } from './export-fixture';
import { scanWorkspaceBundle } from './export-scan';

const detector = vi.hoisted(() => ({ target: '', mode: '', fail: false, privateDirectory: false, calls: 0 }));
// Replace only the external executable. Real Bundle export, staging, validation and cleanup still run.
vi.mock('./gitleaks', () => ({ scanSecrets: async (target: string, mode: string) => {
  detector.calls++; detector.target = target; detector.mode = mode;
  detector.privateDirectory = ((await stat(target)).mode & 0o077) === 0;
  const document = await readFile(join(target, 'workspace.json'), 'utf8');
  if (detector.fail) throw new Error('SCAN_EXECUTION_FAILED');
  const found = document.includes('synthetic-detector-control');
  return { schemaVersion: '1.0.0', ok: !found, code: found ? 'SECRET_FINDINGS' : 'SCAN_CLEAN', tool: 'gitleaks', version: '8.30.1',
    checksumVerified: true, scope: mode, coverage: { maxArchiveDepth: 1, maxDecodeDepth: 2, timeoutSeconds: 30 },
    findingCount: found ? 1 : 0, findings: found ? [{ ruleRef: 'a'.repeat(64), fileRef: 'b'.repeat(64), line: 1 }] : [] };
} }));
beforeEach(() => Object.assign(detector, { target: '', mode: '', fail: false, privateDirectory: false, calls: 0 }));

it('scans validated expanded .rhiza content privately and removes it after returning the safe finding report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-export-scan-test-'));
  try {
    const path = join(root, 'workspace.rhiza');
    const fixture = await exportSecurityFixture(root, { text: 'synthetic-detector-control' }); await fixture.exportTo(path);
    const original = await readFile(path);
    const result = await scanWorkspaceBundle(path);
    expect(result).toMatchObject({ ok: false, code: 'SECRET_FINDINGS', findingCount: 1, scope: 'bundle', validated: true });
    expect(detector.mode).toBe('dir'); expect(detector.privateDirectory).toBe(true);
    await expect(stat(detector.target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path)).toEqual(original);
    expect(JSON.stringify(result).includes(detector.target)).toBe(false);
    expect(JSON.stringify(result).includes('synthetic-detector-control')).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('removes expanded content when the detector fails and rejects invalid archives before any scan', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-export-scan-failure-'));
  try {
    const path = join(root, 'workspace.rhiza'); const fixture = await exportSecurityFixture(root); await fixture.exportTo(path);
    detector.fail = true;
    await expect(scanWorkspaceBundle(path)).rejects.toThrow('SCAN_EXECUTION_FAILED');
    await expect(stat(detector.target)).rejects.toMatchObject({ code: 'ENOENT' });
    const invalid = join(root, 'invalid.rhiza'); await writeFile(invalid, 'invalid archive');
    const priorCalls = detector.calls;
    await expect(scanWorkspaceBundle(invalid)).rejects.toThrow('BUNDLE_INVALID_ARCHIVE');
    expect(detector.calls).toBe(priorCalls);
    expect(await readFile(path)).not.toHaveLength(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
