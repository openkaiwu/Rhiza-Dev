import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { resolve, relative, dirname, extname, join, normalize } from 'node:path';
import ts from 'typescript';

export type M02Violation = { file: string; message: string };

const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts']);
const forbiddenExternal = /^(express|react|node:(fs|path|os|crypto)(\/|$)|pg$|pg\/|openai$|@anthropic-ai\/|@google\/generative-ai|ollama$|ai$|@ai-sdk\/|langchain|@langchain\/)/;
const forbiddenInfrastructure = /(^|\/)(infrastructure|postgres-store|provider-service|provider-runtime|ai-provider|store)(\/|$)/;
const directPortName = /(store|repository|unitofwork|uow)/i;
const layerOrder: Record<string, string[]> = {
  contracts: [],
  domain: ['contracts', 'domain'],
  application: ['contracts', 'domain', 'context-runtime', 'execution-runtime', 'application'],
  http: ['contracts', 'application', 'http'],
};

function fail(message: string): never { throw new Error(message); }

function relativeFile(root: string, file: string) { return relative(root, file).replaceAll('\\', '/'); }

function sourceFile(file: string, source = readFileSync(file, 'utf8')) {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

async function filesUnder(directory: string): Promise<string[]> {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return sourceExtensions.has(extname(entry.name)) && !entry.name.endsWith('.test.ts') ? [path] : [];
  }));
  return nested.flat().sort();
}

function importsIn(file: string): { specifier: string; node: ts.Node }[] {
  const found: { specifier: string; node: ts.Node }[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push({ specifier: node.moduleSpecifier.text, node });
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) {
      found.push({ specifier: node.arguments[0].text, node });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile(file));
  return found;
}

function isForbiddenApplicationImport(specifier: string): boolean {
  return forbiddenExternal.test(specifier) || (specifier.startsWith('.') && forbiddenInfrastructure.test(normalize(specifier).replaceAll('\\', '/')));
}

function layerFor(root: string, file: string): string | undefined {
  const parts = relativeFile(root, file).split('/');
  return parts[0] === 'server' ? parts[1] : undefined;
}

function resolveLocalImport(file: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = resolve(dirname(file), specifier);
  const candidates = [...sourceExtensions].map(extension => `${base}${extension}`).concat([...sourceExtensions].map(extension => join(base, `index${extension}`)));
  return candidates.find(existsSync);
}

function propertyRoot(node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return propertyRoot(node.expression);
  return undefined;
}

function callbackForRoute(call: ts.CallExpression): ts.FunctionLikeDeclaration | undefined {
  return [...call.arguments].reverse().find(argument => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) as ts.FunctionLikeDeclaration | undefined;
}

function bodyCallsApplicationExecute(body: ts.Node): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'execute') {
      const root = propertyRoot(node.expression.expression);
      if (root && /application|appService|commandBus/i.test(root)) found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

function legacyRouteLogic(file: string): boolean {
  if (!importsIn(file).some(({ specifier }) => specifier === 'express')) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['get', 'post', 'put', 'patch', 'delete'].includes(node.expression.name.text)) found = true;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile(file));
  return found;
}

export async function collectM02BoundaryViolations(root = resolve('.'), strict = false): Promise<M02Violation[]> {
  const violations: M02Violation[] = [];
  const report = (file: string, message: string) => violations.push({ file: relativeFile(root, file), message });
  const server = resolve(root, 'server');
  const layers = ['contracts', 'domain', 'application', 'http'];
  const layerFiles = new Map<string, string[]>();
  for (const layer of layers) layerFiles.set(layer, await filesUnder(resolve(server, layer)));

  for (const layer of ['domain', 'application'] as const) {
    for (const file of layerFiles.get(layer) ?? []) {
      for (const { specifier } of importsIn(file)) {
        if (isForbiddenApplicationImport(specifier)) report(file, `${layer} imports forbidden dependency ${specifier}`);
      }
    }
  }

  const graph = new Map<string, Set<string>>();
  for (const layer of layers) {
    for (const file of layerFiles.get(layer) ?? []) {
      graph.set(file, new Set());
      for (const { specifier } of importsIn(file)) {
        const local = resolveLocalImport(file, specifier);
        if (!local) continue;
        graph.get(file)?.add(local);
        const targetLayer = layerFor(root, local);
        if (targetLayer && layerOrder[layer] && !layerOrder[layer].includes(targetLayer)) report(file, `${layer} may not import ${targetLayer} (${specifier})`);
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (file: string, trail: string[]): void => {
    if (visiting.has(file)) { report(file, `dependency cycle: ${[...trail, file].map(path => relativeFile(root, path)).join(' -> ')}`); return; }
    if (visited.has(file)) return;
    visiting.add(file);
    for (const target of graph.get(file) ?? []) if (graph.has(target)) walk(target, [...trail, file]);
    visiting.delete(file); visited.add(file);
  };
  for (const file of graph.keys()) walk(file, []);

  for (const file of layerFiles.get('http') ?? []) {
    const parsed = sourceFile(file);
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && (forbiddenInfrastructure.test(node.moduleSpecifier.text) || node.moduleSpecifier.text === 'pg')) report(file, `http imports persistence/adapter ${node.moduleSpecifier.text}`);
      if (ts.isPropertyAccessExpression(node) && directPortName.test(propertyRoot(node.expression) ?? '')) report(file, `http directly accesses ${propertyRoot(node.expression)}.${node.name.text}`);
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['post', 'put', 'patch', 'delete'].includes(node.expression.name.text)) {
        const callback = callbackForRoute(node);
        if (!callback?.body || !bodyCallsApplicationExecute(callback.body)) report(file, `${node.expression.name.text.toUpperCase()} route is not routed through Application.execute`);
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
  }

  if (strict) {
    const legacy = resolve(server, 'app.ts');
    if (existsSync(legacy) && legacyRouteLogic(legacy)) report(legacy, 'legacy route logic remains; move routes to server/http and invoke the Application facade');
    const registry = resolve(root, 'scripts/boundary-gates/boundary-exceptions.json');
    if (existsSync(registry)) {
      const exceptions = JSON.parse(readFileSync(registry, 'utf8')).exceptions;
      if (Array.isArray(exceptions) && exceptions.length) report(registry, 'M01 boundary exception registry must be empty for M02');
    }
  }
  return violations;
}

export async function verifyM02Boundaries(root = resolve('.'), strict = process.argv.includes('--strict')): Promise<void> {
  const violations = await collectM02BoundaryViolations(root, strict);
  if (violations.length) fail(`M02 architecture boundary gate failed:\n${violations.map(item => `- ${item.file}: ${item.message}`).join('\n')}`);
  console.log(`M02 architecture boundary gate passed${strict ? ' (strict)' : ''}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  verifyM02Boundaries().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
