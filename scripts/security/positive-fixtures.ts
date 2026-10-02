import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZipFile } from 'yazl';
import { scanSecrets } from './gitleaks';

const root = await mkdtemp(join(tmpdir(),'rhiza-gitleaks-fixtures-'));
try {
  // Inert test values are assembled only in temporary fixtures, never saved to the repository or output.
  const values = [
    ['github', ['ghp','_', 'q7Zp4R5t6Y8u9I2o3P1a0S4d5F6g7H8j9K0l'].join('')],
    ['aws', ['AK','IA','Q7ZP4R5T6Y2U3I2O'].join('')],
    ['generic', 'api_key = "' + ['d759d98f','94ab1531','973fbba2','7d2b289c','9dd35a98'].join('') + '"'],
  ];
  const results: Array<{ fixture: string; detected: boolean; sanitized: boolean }> = [];
  for (const [name,value] of values) {
    const directory = join(root,name); await mkdir(directory); await writeFile(join(directory,'fixture.txt'),value,{ mode: 0o600 });
    const report = await scanSecrets(directory,'dir');
    results.push({ fixture: name, detected: report.findingCount >= 1, sanitized: !JSON.stringify(report).includes(value) });
  }
  const zip = new ZipFile(); zip.addBuffer(Buffer.from(values[0][1]),'fixture.txt'); zip.end();
  const parts: Buffer[] = []; for await (const chunk of zip.outputStream) parts.push(Buffer.from(chunk));
  const path = join(root,'fixture.zip'); await writeFile(path,Buffer.concat(parts),{ mode: 0o600 });
  const archive = await scanSecrets(path,'dir'); results.push({ fixture: 'archive', detected: archive.findingCount >= 1, sanitized: !JSON.stringify(archive).includes(values[0][1]) });
  const clean = join(root,'clean'); await mkdir(clean); await writeFile(join(clean,'fixture.txt'),'ordinary nonsecret fixture');
  const negative = await scanSecrets(clean,'dir');
  const detected = results.filter(result => result.detected && result.sanitized).length;
  const result = { schemaVersion: '1.0.0', tool: 'gitleaks', version: '8.30.1', fixtureCount: results.length, detected, detectionPercent: detected / results.length * 100,
    negativeClean: negative.ok, ok: detected === results.length && negative.ok, results };
  console.info(JSON.stringify(result)); if (!result.ok) process.exitCode = 1;
} catch { console.error(JSON.stringify({ ok: false, code: 'SECURITY_FIXTURE_FAILED' })); process.exitCode = 1; }
finally { await rm(root,{ recursive: true, force: true }); }
