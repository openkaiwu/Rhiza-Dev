import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

async function sources(root: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (['node_modules', '.git', 'fixtures', 'dist', 'dist-server', '.superpowers'].includes(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...await sources(path));
    else if (/\.tsx?$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) output.push(path);
  }
  return output;
}

/** Type-aware inventory: ProviderStore and crypto update are unrelated contracts. */
export async function inspectLegacyWriteCallers(root = resolve('server')) {
  const files = await sources(root);
  const program = ts.createProgram(files, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, esModuleInterop: true, skipLibCheck: true });
  const checker = program.getTypeChecker();
  const calls: Array<{ entry: string; operation: string; file: string; line: number; allowed: boolean }> = [];
  for (const path of files) {
    const file = program.getSourceFile(path)!;
    const name = relative(root, path).replaceAll('\\', '/');
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'update') {
        const type = checker.getTypeAtLocation(node.expression.expression);
        const read = checker.getPropertyOfType(type, 'read');
        const signature = read && checker.getSignaturesOfType(checker.getTypeOfSymbolAtLocation(read, node), ts.SignatureKind.Call)[0];
        const result = signature && checker.getAwaitedType(checker.getReturnTypeOfSignature(signature));
        if (result && checker.getPropertyOfType(result, 'discussionNodes')) calls.push({ entry: 'workspace.update', operation: 'call', file: name,
          line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          allowed: ['infrastructure/workspace-repository-unit-of-work.ts', 'infrastructure/resource-backfill.ts'].includes(name) });
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  // These two bridge sites are guarded fixture-only; behavioral regressions prove rejection in production.
  const persistence = files.find(path => path.endsWith('/postgres-store.ts'));
  const sql = persistence ? await readFile(persistence, 'utf8') : '';
  const violations = /deleteMissing|ON CONFLICT \(id\) DO UPDATE/.test(sql) ? ['M10_GENERIC_SNAPSHOT_WRITER_PRESENT'] : [];
  return { schemaVersion: '1.0.0', ok: calls.every(call => call.allowed) && violations.length === 0, calls, violations };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const report = await inspectLegacyWriteCallers();
  console.info(JSON.stringify(report));
  if (!report.ok) process.exitCode = 1;
}
