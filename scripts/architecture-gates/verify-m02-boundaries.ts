import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { resolve, relative, dirname, extname, join, normalize } from 'node:path';
import ts from 'typescript';

export type M02Violation = { file: string; message: string };

const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts']);
const forbiddenExternal = /^(express|react|node:(fs|path|os|crypto|child_process)(\/|$)|pg$|pg\/|(?:@librechat(?:\/|$)|librechat(?:-|\/|$)|openai(?:\/|$)|@anthropic-ai(?:\/|$)|@google\/generative-ai(?:\/|$)|ollama(?:\/|$)|cohere-ai(?:\/|$)|mistralai(?:\/|$)|ai(?:\/|$)|@ai-sdk\/|langchain(?:\/|$)|@langchain\/))/;
const forbiddenInfrastructure = /(^|\/)(infrastructure|postgres-store|provider-service|provider-runtime|ai-provider|store)(\/|$)/;
const directPortName = /(store|repository|unitofwork|uow)/i;
const layerOrder: Record<string, string[]> = {
  contracts: ['contracts', 'domain'],
  domain: ['contracts', 'domain'],
  'context-runtime': ['domain', 'context-runtime'],
  'execution-runtime': ['domain', 'execution-runtime'],
  application: ['contracts', 'domain', 'context-runtime', 'execution-runtime', 'application'],
  http: ['contracts', 'application', 'http'],
  'runtime-adapters': ['domain', 'execution-runtime', 'runtime-adapters'],
  infrastructure: ['domain', 'application', 'infrastructure'],
  // Bootstrap is the composition root. It may wire every M02 partition, but
  // the gate still scans it so its source files cannot become invisible.
  'host-node': ['contracts', 'domain', 'context-runtime', 'execution-runtime', 'application', 'http', 'runtime-adapters', 'infrastructure', 'host-node'],
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
  if (parts[0] !== 'server') return undefined;
  if (parts.length === 2 && ['domain.ts', 'provider-domain.ts'].includes(parts[1])) return 'domain';
  return layerOrder[parts[1]] ? parts[1] : undefined;
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

function ancestorMap(root: ts.Node): Map<ts.Node, ts.Node | undefined> {
  const parents = new Map<ts.Node, ts.Node | undefined>();
  const visit = (node: ts.Node, parent: ts.Node | undefined): void => {
    parents.set(node, parent);
    ts.forEachChild(node, child => visit(child, node));
  };
  visit(root, undefined);
  return parents;
}

function isContractsApplicationImport(declaration: ts.ImportDeclaration): boolean {
  return ts.isStringLiteral(declaration.moduleSpecifier)
    && /(^|\/)contracts\/application$/.test(normalize(declaration.moduleSpecifier.text).replaceAll('\\', '/'));
}

function applicationFactoryBindings(parsed: ts.SourceFile): Map<ts.SignatureDeclaration, Set<string>> {
  const bindings = new Map<ts.SignatureDeclaration, Set<string>>();
  const applicationTypes = new Set<string>();
  const visitImports = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && isContractsApplicationImport(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      for (const element of node.importClause.namedBindings.elements) if (element.propertyName?.text === 'Application' || element.name.text === 'Application') applicationTypes.add(element.name.text);
    }
    ts.forEachChild(node, visitImports);
  };
  visitImports(parsed);
  const visitFactories = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) {
      const names = new Set<string>();
      for (const parameter of node.parameters) {
        if (!ts.isIdentifier(parameter.name) || !parameter.type || !ts.isTypeReferenceNode(parameter.type) || !ts.isIdentifier(parameter.type.typeName)) continue;
        if (applicationTypes.has(parameter.type.typeName.text)) names.add(parameter.name.text);
      }
      if (names.size) bindings.set(node, names);
    }
    ts.forEachChild(node, visitFactories);
  };
  visitFactories(parsed);
  return bindings;
}

function factoryFor(node: ts.Node, parents: Map<ts.Node, ts.Node | undefined>, bindings: Map<ts.SignatureDeclaration, Set<string>>): Set<string> | undefined {
  for (let current: ts.Node | undefined = node; current; current = parents.get(current)) {
    if (ts.isFunctionLike(current) && bindings.has(current)) return bindings.get(current);
  }
  return undefined;
}

function isApplicationExecuteCall(node: ts.Node, applicationBindings: Set<string>): boolean {
  return ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'execute'
    && applicationBindings.has(propertyRoot(node.expression.expression) ?? '');
}

function approvedExecuteHelpers(parsed: ts.SourceFile, applicationBindings: Set<string>): Set<string> {
  const helpers = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      let invokesApplication = false;
      const inspect = (child: ts.Node): void => { if (isApplicationExecuteCall(child, applicationBindings)) invokesApplication = true; ts.forEachChild(child, inspect); };
      inspect(node.initializer.body);
      if (invokesApplication) helpers.add(node.name.text);
    }
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      let invokesApplication = false;
      const inspect = (child: ts.Node): void => { if (isApplicationExecuteCall(child, applicationBindings)) invokesApplication = true; ts.forEachChild(child, inspect); };
      inspect(node.body);
      if (invokesApplication) helpers.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return helpers;
}

function bodyCallsApplicationExecute(body: ts.Node, applicationBindings: Set<string>, helpers: Set<string>): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (isApplicationExecuteCall(node, applicationBindings)) found = true;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && helpers.has(node.expression.text)) found = true;
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

function directPortAliases(parsed: ts.SourceFile): { ports: Set<string>; methods: Set<string> } {
  const ports = new Set<string>();
  const methods = new Set<string>();
  const declarations: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && directPortName.test(node.name.text)) ports.add(node.name.text);
    if (ts.isVariableDeclaration(node)) declarations.push(node);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  for (const declaration of declarations) if (ts.isIdentifier(declaration.name) && directPortName.test(declaration.name.text)) ports.add(declaration.name.text);
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      if (!declaration.initializer) continue;
      const root = propertyRoot(declaration.initializer as ts.Expression);
      if (!root || !ports.has(root)) continue;
      if (ts.isIdentifier(declaration.name) && !ports.has(declaration.name.text)) { ports.add(declaration.name.text); changed = true; }
      if (ts.isObjectBindingPattern(declaration.name)) {
        for (const element of declaration.name.elements) if (ts.isIdentifier(element.name) && !methods.has(element.name.text)) { methods.add(element.name.text); changed = true; }
      }
    }
  }
  return { ports, methods };
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
  const layers = ['contracts', 'domain', 'context-runtime', 'execution-runtime', 'application', 'http', 'runtime-adapters', 'infrastructure', 'host-node'];
  const layerFiles = new Map<string, string[]>();
  for (const layer of layers) layerFiles.set(layer, await filesUnder(resolve(server, layer)));
  layerFiles.set('domain', [...(layerFiles.get('domain') ?? []), ...['domain.ts', 'provider-domain.ts'].map(file => resolve(server, file)).filter(existsSync)]);

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
    const parents = ancestorMap(parsed);
    const factories = applicationFactoryBindings(parsed);
    const ports = directPortAliases(parsed);
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && (forbiddenInfrastructure.test(node.moduleSpecifier.text) || node.moduleSpecifier.text === 'pg')) report(file, `http imports persistence/adapter ${node.moduleSpecifier.text}`);
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ports.ports.has(propertyRoot(node.expression.expression) ?? '')) report(file, `http directly calls ${propertyRoot(node.expression.expression)}.${node.expression.name.text}`);
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ports.methods.has(node.expression.text)) report(file, `http directly calls destructured persistence method ${node.expression.text}`);
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['post', 'put', 'patch', 'delete'].includes(node.expression.name.text)) {
        const callback = callbackForRoute(node);
        const applicationBindings = factoryFor(node, parents, factories);
        const helpers = applicationBindings ? approvedExecuteHelpers(parsed, applicationBindings) : new Set<string>();
        if (!callback?.body || !applicationBindings || !bodyCallsApplicationExecute(callback.body, applicationBindings, helpers)) report(file, `${node.expression.name.text.toUpperCase()} route is not routed through an injected Application.execute`);
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
