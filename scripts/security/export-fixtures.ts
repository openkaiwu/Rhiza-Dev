import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportSecurityFixture } from './export-fixture';
import { scanWorkspaceBundle } from './export-scan';

const root = await mkdtemp(join(tmpdir(), 'rhiza-export-security-fixtures-'));
try {
  // Inert control: assembled only in private temporary fixtures, never included in reports.
  const token = ['ghp', '_', 'q7Zp4R5t6Y8u9I2o3P1a0S4d5F6g7H8j9K0l'].join('');
  const results = [];
  for (const positive of [false, true]) {
    const directory = join(root, positive ? 'positive' : 'clean'); await mkdir(directory, { mode: 0o700 });
    const fixture = await exportSecurityFixture(directory, { text: 'Business discussion of /private/design.md and latitude 37.333',
      attachmentText: positive ? token : 'Ordinary attachment content', metadata: { access_token: token, path: '/private/operational-sentinel', location: { latitude: 51.500731, longitude: -0.124628 } } });
    const path = join(directory, 'workspace.rhiza'); await fixture.exportTo(path);
    const report = await scanWorkspaceBundle(path);
    results.push({ fixture: positive ? 'attachment-positive' : 'sanitized-export-negative', ok: positive ? !report.ok && report.findingCount > 0 : report.ok,
      findingCount: report.findingCount, sanitized: !JSON.stringify(report).includes(token) && !JSON.stringify(report).includes(root), validated: report.validated });
  }
  const result = { schemaVersion: '1.0.0', tool: 'gitleaks', version: '8.30.1', ok: results.every(item => item.ok && item.sanitized && item.validated), results };
  console.info(JSON.stringify(result)); if (!result.ok) process.exitCode = 1;
} catch { console.error(JSON.stringify({ ok: false, code: 'EXPORT_SECURITY_FIXTURE_FAILED' })); process.exitCode = 1; }
finally { await rm(root, { recursive: true, force: true }); }
