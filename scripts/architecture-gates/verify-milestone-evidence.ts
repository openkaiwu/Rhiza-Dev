import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = resolve(import.meta.dirname, '../..');
const schemaPath = resolve(root, 'docs/architecture-gates/milestone-evidence.schema.json');

type Checksum = { algorithm: 'sha256'; current: string; recorded_commit: string };
type CommandResult = { command: string; result: 'pass' | 'fail' | 'skipped' };
type KnownException = { owner: string; expiry: string; adr_or_issue: string; severity: 'blocking' | 'observational' };
export type MilestoneEvidence = {
  $schema: 'https://rhiza.dev/architecture-gates/milestone-evidence/1.0.0'; schema_version: '1.0.0'; milestone: string;
  architecture_version: 'V4.0'; commit: string; fixtures: Array<{ id: string; path: string; role: string }>;
  commands: CommandResult[]; checksums: Record<string, Checksum>;
  failure_classification: { classification: string; rationale: string }; known_exceptions: KnownException[];
  environment: { node: string; os: string; cpu: string; memory_bytes: number }; started_at: string; completed_at: string; result: 'pass' | 'fail';
};

export const M01_COMMANDS = [
  'pnpm run lint',
  'pnpm run typecheck',
  'pnpm run test:unit',
  'pnpm run test:e2e',
  'pnpm run licenses:verify',
  'pnpm run verify:g0',
  'pnpm run build',
];
export const M01_PATHS = [
  '.github/workflows/ci.yml',
  '.gitignore',
  'README.md',
  'pnpm-lock.yaml',
  'package.json',
  'reports/third-party-licenses.json',
  'app/static/css/app.css',
  'db/migrations/0004_immutable_manifest_history.down.sql',
  'db/migrations/0004_immutable_manifest_history.up.sql',
  'docs/adr/ADR-001-module-dependency-direction.md',
  'docs/adr/ADR-002-identity-workspace-scope.md',
  'docs/adr/ADR-003-resource-identity-and-content-hash.md',
  'docs/adr/ADR-004-state-journal-receipt-transaction.md',
  'docs/architecture-gates/fixture-registry.json',
  'docs/architecture-gates/G0/characterization-map.json',
  'docs/architecture-gates/G0/evidence.json',
  'docs/architecture-gates/performance-profile.json',
  'docs/architecture-gates/G0/snapshots/api.json',
  'docs/architecture-gates/G0/snapshots/db.json',
  'docs/architecture-gates/G0/snapshots/schema-index.json',
  'docs/architecture-gates/README.md',
  'docs/architecture-gates/ci-observation.schema.json',
  'docs/architecture-gates/evidence-manifest.schema.json',
  'docs/architecture-gates/milestone-evidence.schema.json',
  'docs/architecture.md',
  'e2e/postgres-migration.e2e.test.ts',
  'e2e/postgres-schema.e2e.test.ts',
  'e2e/postgres-store.e2e.test.ts',
  'eslint.config.js',
  'scripts/architecture-gates/repository-hygiene.test.ts',
  'scripts/architecture-gates/repository-hygiene.ts',
  'scripts/architecture-gates/run-characterization.ts',
  'scripts/architecture-gates/verify-g0.test.ts',
  'scripts/architecture-gates/verify-g0.ts',
  'scripts/architecture-gates/verify-milestone-evidence.test.ts',
  'scripts/architecture-gates/verify-milestone-evidence.ts',
  'scripts/generate-license-report.mjs',
  'scripts/boundary-gates/boundary-exceptions.json',
  'scripts/boundary-gates/boundary-exceptions.schema.json',
  'scripts/boundary-gates/boundary-lint.test.ts',
  'scripts/boundary-gates/fixtures/domain-imports-express.txt',
  'scripts/boundary-gates/fixtures/domain-imports-node-fs.txt',
  'scripts/boundary-gates/fixtures/http-imports-persistence.txt',
  'scripts/boundary-gates/fixtures/route-imports-postgres-store.txt',
  'scripts/boundary-gates/fixtures/web-imports-server.txt',
  'scripts/boundary-gates/verify-boundary-exceptions.ts',
  'scripts/migrate.test.ts',
  'server/app.test.ts',
  'server/app.ts',
  'server/g0-fixture-characterization.test.ts',
  'server/store.ts',
  'server/postgres-store.ts',
  'src/App.test.tsx',
  'src/App.tsx',
  'src/api.ts',
  'src/components/GraphView.test.tsx',
  'src/components/GraphView.tsx',
  'src/test/setup.ts',
];

export const M01_FIXTURES = [
  { id: 'g0-fixture-registry-v1', path: 'docs/architecture-gates/fixture-registry.json', role: 'fixture_registry' },
  { id: 'g0-characterization-map-v1', path: 'docs/architecture-gates/G0/characterization-map.json', role: 'characterization_map' },
  { id: 'g0-blocking-evidence-v1', path: 'docs/architecture-gates/G0/evidence.json', role: 'acceptance_fixture' },
];

const milestoneConfig = (milestone: string) => milestone === 'M01'
  ? { commands: M01_COMMANDS, paths: M01_PATHS, fixtures: M01_FIXTURES }
  : fail(`no verifier is configured for ${milestone}`);

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const git = (args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const gitObject = (commit: string, path: string): Buffer => execFileSync('git', ['show', `${commit}:${path}`], { cwd: root });
const fail = (message: string): never => { throw new Error(`Milestone evidence verification failed: ${message}`); };

export function isCommitAncestor(commit: string, head: string): boolean {
  return spawnSync('git', ['merge-base', '--is-ancestor', commit, head], { cwd: root }).status === 0;
}

export function validateKnownExceptions(exceptions: KnownException[], now = new Date()): void {
  const today = now.toISOString().slice(0, 10);
  for (const exception of exceptions) {
    if (!exception.owner || !exception.adr_or_issue || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(exception.expiry)) fail('known exception requires owner, issue/ADR, and YYYY-MM-DD expiry');
    if (exception.expiry < today) fail(`known exception ${exception.adr_or_issue} expired on ${exception.expiry}${exception.severity === 'observational' ? ' and escalates to blocking' : ''}`);
  }
}

export function validateEvidence(evidence: MilestoneEvidence, head = git(['rev-parse', 'HEAD']), expectedMilestone?: string): void {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(evidence)) fail(ajv.errorsText(validate.errors, { separator: '; ' }));
  if (expectedMilestone) {
    const config = milestoneConfig(expectedMilestone);
    if (evidence.milestone !== expectedMilestone) fail(`evidence milestone ${evidence.milestone} does not match requested ${expectedMilestone}`);
    if (evidence.commands.map(command => command.command).join('\n') !== config.commands.join('\n')) fail(`${expectedMilestone} command set drift`);
    if (Object.keys(evidence.checksums).sort().join('\n') !== [...config.paths].sort().join('\n')) fail(`${expectedMilestone} checksum path set drift`);
    if (JSON.stringify(evidence.fixtures) !== JSON.stringify(config.fixtures)) fail(`${expectedMilestone} fixture set drift`);
  }
  if (evidence.result !== 'pass') fail('evidence result is not pass');
  if (evidence.commands.some(command => command.result !== 'pass')) fail('evidence contains a failing or skipped command');
  validateKnownExceptions(evidence.known_exceptions);
  for (const fixture of evidence.fixtures) {
    if (!(fixture.path in evidence.checksums)) fail(`fixture is not checksummed: ${fixture.path}`);
  }
  if (spawnSync('git', ['cat-file', '-e', `${evidence.commit}^{commit}`], { cwd: root }).status !== 0) fail(`recorded commit does not exist: ${evidence.commit}`);
  if (!isCommitAncestor(evidence.commit, head)) fail(`recorded commit is not an ancestor of HEAD: ${evidence.commit}`);
  for (const [path, checksum] of Object.entries(evidence.checksums)) {
    if (path.startsWith('/') || path.split('/').includes('..')) fail(`unsafe checksum path: ${path}`);
    if (!existsSync(resolve(root, path))) fail(`checksummed path is missing: ${path}`);
    const current = sha256(readFileSync(resolve(root, path)));
    const recorded = sha256(gitObject(evidence.commit, path));
    if (checksum.current !== current) fail(`current checksum drift: ${path}`);
    if (checksum.recorded_commit !== recorded) fail(`recorded commit checksum drift: ${path}`);
    if (checksum.current !== checksum.recorded_commit) fail(`checksum is not bound to recorded commit: ${path}`);
  }
}

function runGate(commands: string[]): CommandResult[] {
  return commands.map(command => {
    const result = spawnSync(command, { cwd: root, shell: true, stdio: 'inherit' });
    if (result.status !== 0) fail(`gate command failed: ${command}`);
    return { command, result: 'pass' };
  });
}

function writeEvidence(milestone: string): void {
  const config = milestoneConfig(milestone);
  const started_at = new Date().toISOString();
  const commands = runGate(config.commands);
  const commit = git(['rev-parse', 'HEAD']);
  const evidence: MilestoneEvidence = {
    $schema: 'https://rhiza.dev/architecture-gates/milestone-evidence/1.0.0', schema_version: '1.0.0', milestone,
    architecture_version: 'V4.0', commit,
    fixtures: config.fixtures,
    commands,
    checksums: Object.fromEntries(config.paths.map(path => {
      const digest = sha256(readFileSync(resolve(root, path)));
      return [path, { algorithm: 'sha256', current: digest, recorded_commit: digest }];
    })),
    failure_classification: { classification: 'known_exception', rationale: 'All blocking M01 commands passed; the legacy HTTP-to-repository port access remains an owned observational exception until M02.' },
    known_exceptions: [{ owner: 'M02 Application-boundary implementer', expiry: '2026-09-30', adr_or_issue: 'INH-8 / M02', severity: 'observational' }],
    environment: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model ?? 'unknown', memory_bytes: totalmem() },
    started_at, completed_at: new Date().toISOString(), result: 'pass',
  };
  validateEvidence(evidence, commit, milestone);
  const path = resolve(root, `docs/architecture-gates/${milestone}/evidence.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`wrote ${path}`);
}

function main(): void {
  const milestoneIndex = process.argv.indexOf('--milestone');
  const milestone = milestoneIndex >= 0 ? (process.argv[milestoneIndex + 1] ?? '') : '';
  if (milestone.length === 0) fail('pass --milestone M01 and optionally --write');
  if (process.argv.includes('--write')) return writeEvidence(milestone);
  const path = resolve(root, `docs/architecture-gates/${milestone}/evidence.json`);
  if (!existsSync(path)) fail(`evidence file is missing: ${path}`);
  validateEvidence(JSON.parse(readFileSync(path, 'utf8')) as MilestoneEvidence, undefined, milestone);
  console.log(`${milestone} milestone evidence passes`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
