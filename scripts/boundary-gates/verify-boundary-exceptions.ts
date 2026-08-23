import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

interface BoundaryException {
  id: string;
  boundary: string;
  file: string;
  reason: string;
  owner: string;
  issue: string;
  expiresOn: string;
  repositoryAccessBudget: string[];
}

interface BoundaryExceptionRegistry {
  exceptions: BoundaryException[];
}

const root = resolve('.');

export function analyzeRepositoryAccess(source: string, parameterName: string): string[] {
  const sourceFile = ts.createSourceFile('legacy-route.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const accesses = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === parameterName) {
      accesses.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...accesses].sort();
}

function assertion(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function assertExceptionIsCurrent(exception: Pick<BoundaryException, 'file' | 'expiresOn'>, today: string): void {
  assertion(exception.expiresOn > today, `${exception.file} exception expired on ${exception.expiresOn}`);
}

export function assertRepositoryAccessBudget(source: string, parameterName: string, budget: string[], file: string): void {
  const actual = analyzeRepositoryAccess(source, parameterName);
  const expected = [...budget].sort();
  assertion(JSON.stringify(actual) === JSON.stringify(expected), `${file} repository access budget changed: expected ${expected.join(', ')}, found ${actual.join(', ')}`);
}

export async function loadAndValidateBoundaryExceptions(today = new Date().toISOString().slice(0, 10)): Promise<BoundaryException[]> {
  const registryPath = resolve(root, 'scripts/boundary-gates/boundary-exceptions.json');
  const schemaPath = resolve(root, 'scripts/boundary-gates/boundary-exceptions.schema.json');
  const [registryJson, schemaJson] = await Promise.all([readFile(registryPath, 'utf8'), readFile(schemaPath, 'utf8')]);
  const registry = JSON.parse(registryJson) as BoundaryExceptionRegistry;
  const schema = JSON.parse(schemaJson) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assertion(validate(registry), `boundary exception registry schema error: ${ajv.errorsText(validate.errors)}`);

  for (const exception of registry.exceptions) {
    assertion(exception.owner.trim(), `${exception.id} requires an owner`);
    assertion(exception.issue.trim(), `${exception.id} requires an issue`);
    assertExceptionIsCurrent(exception, today);
    await access(resolve(root, exception.file));

    if (exception.boundary !== 'http-must-not-import-persistence-adapter') continue;
    const source = await readFile(resolve(root, exception.file), 'utf8');
    assertRepositoryAccessBudget(source, 'store', exception.repositoryAccessBudget, exception.file);
  }

  return registry.exceptions;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  loadAndValidateBoundaryExceptions().then(() => {
    console.log('Boundary exceptions validated.');
  }).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
