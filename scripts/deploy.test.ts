import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const bashScript = resolve(root, 'scripts/deploy.sh');
const powershellScript = resolve(root, 'scripts/deploy.ps1');
const bashSource = readFileSync(bashScript, 'utf8');
const powershellSource = readFileSync(powershellScript, 'utf8');

describe('deployment wizards', () => {
  it('keeps the macOS/Linux entrypoint syntactically valid', () => {
    const result = spawnSync('bash', ['-n', bashScript], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('offers the same locked runtime and deployment decisions on both platforms', () => {
    for (const source of [bashSource, powershellSource]) {
      expect(source).toContain('24');
      expect(source).toContain('11.19.0');
      expect(source).toContain('restart service');
      expect(source).toContain('stop service');
      expect(source).toContain('default settings');
      expect(source).toContain('custom settings');
      expect(source).toContain('/api/health');
      expect(source).toContain('already in use');
      expect(source).toContain('dist-server/index.js');
      expect(source).toContain('DATABASE_URL');
    }
  });

  it('never treats a development watcher as a wizard-managed production process', () => {
    expect(bashSource).not.toContain('command_line" == *"server/index.ts');
    expect(powershellSource).not.toContain('|server[\\/]index\\.ts');
  });
});
