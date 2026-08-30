import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts']);
const osModules = /^(?:node:)?(?:fs|fs\/promises|path|os|crypto|child_process|worker_threads|cluster|net|tls|dgram|readline|tty|process)$/;

async function filesUnder(path: string): Promise<string[]> {
  if (!existsSync(path)) return [];
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map(async entry => {
    const nested = join(path, entry.name);
    if (entry.isDirectory()) return filesUnder(nested);
    return sourceExtensions.has(extname(entry.name)) && !entry.name.includes('.test.') ? [nested] : [];
  }))).flat();
}

export async function findCoreOsImports(root = resolve('.')): Promise<Array<{ file: string; specifier: string }>> {
  const files = [resolve(root, 'server/domain.ts'), ...await filesUnder(resolve(root, 'server/domain')), ...await filesUnder(resolve(root, 'server/application'))];
  const violations: Array<{ file: string; specifier: string }> = [];
  for (const file of files.filter(existsSync)) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && osModules.test(node.moduleSpecifier.text)) violations.push({ file: relative(root, file).replaceAll('\\', '/'), specifier: node.moduleSpecifier.text });
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return violations;
}

async function main() {
  const violations = await findCoreOsImports();
  if (violations.length) throw new Error(`Domain/Application OS imports must be zero:\n${violations.map(item => `${item.file}: ${item.specifier}`).join('\n')}`);
  console.log('M04 Host boundary passed: Domain/Application OS imports = 0.');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) await main();
