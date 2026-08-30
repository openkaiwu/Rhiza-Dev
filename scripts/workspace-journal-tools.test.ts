// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Workspace Journal CLI source safety', () => {
  it.each(['import-json-workspace.ts', 'reconcile-workspace.ts'])('%s rejects missing input without creating source or target data', async script => {
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-journal-cli-'));
    const source = join(directory, 'missing.json');
    const database = join(directory, 'database');
    try {
      const result = spawnSync(process.execPath, ['--import', 'tsx', resolve('scripts', script), '--', source], {
        encoding: 'utf8', timeout: 15_000,
        env: { ...process.env, DATABASE_URL: '', RHIZA_EMBEDDED_DATA_DIR: database },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('WORKSPACE_DATA_MISSING');
      await expect(access(source)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(database)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
