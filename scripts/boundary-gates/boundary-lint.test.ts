// @vitest-environment node
import { ESLint } from 'eslint';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeRepositoryAccess, assertExceptionIsCurrent, assertRepositoryAccessBudget, loadAndValidateBoundaryExceptions } from './verify-boundary-exceptions';

const eslint = new ESLint({ cwd: resolve('.') });

async function restrictedImports(source: string, filePath: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter(message => message.ruleId === 'no-restricted-imports');
}

async function fixture(name: string) {
  return readFile(resolve('scripts/boundary-gates/fixtures', name), 'utf8');
}

describe('M02 ESLint boundary gates', () => {
  it('closes every temporary Application-boundary exception', async () => {
    await expect(loadAndValidateBoundaryExceptions()).resolves.toEqual([]);
  });

  it('keeps the compatibility export free of repository access', async () => {
    const source = await readFile(resolve('server/app.ts'), 'utf8');
    expect(analyzeRepositoryAccess(source, 'store')).toEqual([]);
    expect(() => assertRepositoryAccessBudget(`${source}\nvoid store.read;`, 'store', [], 'server/app.ts')).toThrow('repository access budget changed');
  });

  it('fails when a boundary exception expires', () => {
    expect(() => assertExceptionIsCurrent({ file: 'server/app.ts', expiresOn: '2026-09-30' }, '2026-09-30')).toThrow('exception expired');
  });

  it.each([
    ['Domain may not import Express', 'domain-imports-express.txt', 'server/domain/fixture.ts'],
    ['Domain may not import node:fs', 'domain-imports-node-fs.txt', 'server/domain/fixture.ts'],
    ['Web may not import server internals', 'web-imports-server.txt', 'src/fixtures/boundary-violation.ts'],
    ['HTTP may not import persistence adapters', 'http-imports-persistence.txt', 'server/http/fixture.ts'],
    ['Legacy routes may not import a concrete persistence adapter', 'route-imports-postgres-store.txt', 'server/app.ts'],
  ])('%s', async (_name, fixtureName, filePath) => {
    expect(await restrictedImports(await fixture(fixtureName), filePath)).toHaveLength(1);
  });
});
