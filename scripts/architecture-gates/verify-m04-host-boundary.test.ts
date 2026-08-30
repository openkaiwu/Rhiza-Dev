import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { findCoreOsImports } from './verify-m04-host-boundary';

describe('M04 Host boundary', () => {
  it('keeps current Domain/Application OS imports at zero', async () => {
    await expect(findCoreOsImports()).resolves.toEqual([]);
  });

  it('detects a direct application filesystem import', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rhiza-m04-boundary-'));
    try {
      await mkdir(join(root, 'server/application'), { recursive: true });
      await writeFile(join(root, 'server/domain.ts'), 'export {};');
      await writeFile(join(root, 'server/application/bad.ts'), "import { readFile } from 'node:fs/promises'; void readFile;");
      await expect(findCoreOsImports(root)).resolves.toEqual([{ file: 'server/application/bad.ts', specifier: 'node:fs/promises' }]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
