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
type FailureClassification = MilestoneEvidence['failure_classification'];
type MilestoneConfig = {
  architectureVersion: 'V4.0' | 'V4.1' | 'V4.2';
  commands: string[];
  paths: string[];
  fixtures: Array<{ id: string; path: string; role: string }>;
  failureClassification: FailureClassification;
  knownExceptions: KnownException[];
  severity?: 'blocking' | 'observational';
  thresholds?: Record<string, unknown>;
  failureInjectionCheckpoint?: { checkpoint: string; injection_command: string; expected: string };
  recoveryCommand?: string;
};
export type MilestoneEvidence = {
  $schema: 'https://rhiza.dev/architecture-gates/milestone-evidence/1.0.0'; schema_version: '1.0.0'; milestone: string;
  architecture_version: 'V4.0' | 'V4.1' | 'V4.2'; commit: string; fixtures: Array<{ id: string; path: string; role: string }>;
  commands: CommandResult[]; checksums: Record<string, Checksum>;
  failure_classification: { classification: string; rationale: string }; known_exceptions: KnownException[];
  severity?: 'blocking' | 'observational'; thresholds?: Record<string, unknown>; observed_metrics?: Record<string, unknown>;
  failure_injection_checkpoint?: { checkpoint: string; injection_command: string; expected: string }; recovery_command?: string;
  environment: { node: string; os: string; cpu: string; memory_bytes: number }; started_at: string; completed_at: string; result: 'pass' | 'fail';
};

export type EvidenceValidationOptions = {
  /**
   * Require the checkout to still match the commit-bound evidence. This is
   * appropriate while generating evidence for the current milestone; normal
   * reads intentionally validate historical evidence against its Git object.
   */
  strictCurrent?: boolean;
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

export const M02_COMMANDS = [
  'pnpm run lint',
  'pnpm run typecheck',
  'pnpm run test:unit',
  'pnpm run test:e2e',
  'pnpm run licenses:verify',
  'pnpm run verify:g0',
  'pnpm run verify:m02:boundaries',
  'pnpm run build',
];

export const M02_PATHS = [
  '.github/workflows/ci.yml',
  '.gitignore',
  'eslint.config.js',
  'package.json',
  'docs/architecture-gates/README.md',
  'docs/architecture-gates/fixture-registry.json',
  'docs/architecture-gates/G0/characterization-map.json',
  'docs/architecture-gates/G0/evidence.json',
  'scripts/architecture-gates/verify-g0.ts',
  'scripts/architecture-gates/verify-m02-boundaries.test.ts',
  'scripts/architecture-gates/verify-m02-boundaries.ts',
  'scripts/architecture-gates/verify-milestone-evidence.test.ts',
  'scripts/architecture-gates/verify-milestone-evidence.ts',
  'scripts/boundary-gates/boundary-exceptions.json',
  'scripts/boundary-gates/boundary-lint.test.ts',
  'server/app.ts',
  'server/app.test.ts',
  'server/ai-provider.test.ts',
  'server/ai-provider.ts',
  'server/application/create-application.test.ts',
  'server/application/create-application.ts',
  'server/application/ports/legacy-upload.ts',
  'server/application/ports/provider-management.ts',
  'server/application/ports/runtime.ts',
  'server/application/ports/workspace-unit-of-work.ts',
  'server/context-runtime/legacy-planner.ts',
  'server/context-runtime/port.ts',
  'server/contracts/application-error.test.ts',
  'server/contracts/application-error.ts',
  'server/contracts/application.ts',
  'server/contracts/references.ts',
  'server/domain/message-version.test.ts',
  'server/domain/message-version.ts',
  'server/execution-runtime/runtime.ts',
  'server/host-node/create-app.ts',
  'server/http/app.ts',
  'server/infrastructure/node-filesystem-legacy-upload.test.ts',
  'server/infrastructure/node-filesystem-legacy-upload.ts',
  'server/infrastructure/workspace-repository-unit-of-work.test.ts',
  'server/infrastructure/workspace-repository-unit-of-work.ts',
  'server/provider-runtime.ts',
  'server/runtime-adapters/provider-runtime.ts',
  'src/App.test.tsx',
  'src/App.tsx',
  'src/api.ts',
  'src/components/ChatView.tsx',
  'src/components/GraphView.tsx',
  'src/components/MarkdownRenderer.tsx',
  'src/components/ProviderSettings.tsx',
  'src/error-presentation.test.ts',
  'src/error-presentation.ts',
  'tsconfig.application-layer.json',
  'tsconfig.context-runtime.json',
  'tsconfig.contracts.json',
  'tsconfig.domain.json',
  'tsconfig.execution-runtime.json',
  'tsconfig.http-layer.json',
  'tsconfig.json',
  'tsconfig.runtime-adapters.json',
];

export const M02_FIXTURES = [
  { id: 'g0-fixture-registry-v1', path: 'docs/architecture-gates/fixture-registry.json', role: 'fixture_registry' },
  { id: 'g0-characterization-map-v1', path: 'docs/architecture-gates/G0/characterization-map.json', role: 'characterization_map' },
  { id: 'g0-blocking-evidence-v1', path: 'docs/architecture-gates/G0/evidence.json', role: 'acceptance_fixture' },
  { id: 'm02-empty-boundary-exception-registry-v1', path: 'scripts/boundary-gates/boundary-exceptions.json', role: 'acceptance_fixture' },
];

const M01_CONFIG: MilestoneConfig = {
  architectureVersion: 'V4.0',
  commands: M01_COMMANDS,
  paths: M01_PATHS,
  fixtures: M01_FIXTURES,
  failureClassification: {
    classification: 'known_exception',
    rationale: 'All blocking M01 commands passed; the legacy HTTP-to-repository port access remains an owned observational exception until M02.',
  },
  knownExceptions: [{ owner: 'M02 Application-boundary implementer', expiry: '2026-09-30', adr_or_issue: 'INH-8 / M02', severity: 'observational' }],
};

const M02_CONFIG: MilestoneConfig = {
  architectureVersion: 'V4.0',
  commands: M02_COMMANDS,
  paths: M02_PATHS,
  fixtures: M02_FIXTURES,
  failureClassification: {
    classification: 'none',
    rationale: 'All M02 blocking commands passed; latency deltas remain observational under the V4 roadmap and do not waive a blocking requirement.',
  },
  knownExceptions: [],
};
export const M03_COMMANDS = [...M02_COMMANDS.slice(0, 6), 'pnpm vitest run server/app.test.ts server/application/create-application.test.ts e2e/postgres-schema.e2e.test.ts scripts/migrate.test.ts --maxWorkers=1 --testTimeout=30000', 'pnpm run build'];
export const M03_PATHS = [...new Set([...M02_PATHS,
  'README.md', 'db/migrations/0005_identity_workspace_scope.up.sql', 'db/migrations/0005_identity_workspace_scope.down.sql',
  'docs/architecture-gates/G0/evidence.json', 'docs/architecture-gates/G0/snapshots/api.json', 'docs/architecture-gates/G0/snapshots/db.json', 'docs/architecture-gates/G0/snapshots/schema-index.json', 'docs/architecture-gates/README.md', 'docs/architecture-gates/milestone-evidence.schema.json',
  'e2e/postgres-schema.e2e.test.ts', 'e2e/postgres-migration.e2e.test.ts', 'e2e/postgres-store.e2e.test.ts', 'package.json',
  'scripts/architecture-gates/verify-m02-boundaries.test.ts', 'scripts/architecture-gates/verify-m02-boundaries.ts', 'scripts/architecture-gates/verify-milestone-evidence.test.ts', 'scripts/architecture-gates/verify-milestone-evidence.ts', 'scripts/migrate.test.ts',
  'server/context-planner.test.ts', 'server/contracts/application.ts', 'server/contracts/references.ts', 'server/host-node/create-app.ts', 'server/http/app.ts', 'server/identity/workspace-directory.ts', 'server/identity/workspace-scope.ts', 'server/index.ts', 'server/infrastructure/workspace-repository-unit-of-work.test.ts', 'server/infrastructure/workspace-repository-unit-of-work.ts', 'server/postgres-store.ts', 'server/store.ts',
  'src/App.test.tsx', 'src/App.tsx', 'src/api.test.ts', 'src/api.ts', 'src/components/GraphView.test.tsx', 'src/components/Sidebar.tsx', 'src/types.ts', 'tsconfig.application-layer.json',
])];
export const M03_FIXTURES = M02_FIXTURES;
export function m03ObservedMetrics(databaseUrl = process.env.DATABASE_URL): Record<string, unknown> {
  return {
    required_gate_commands: M03_COMMANDS.length,
    real_postgres_e2e: databaseUrl
      ? { status: 'pass' }
      : { status: 'skipped', reason: 'DATABASE_URL is not configured in this evidence environment' },
  };
}
const M03_CONFIG: MilestoneConfig = {
  architectureVersion: 'V4.1',
  commands: M03_COMMANDS,
  paths: M03_PATHS,
  fixtures: M03_FIXTURES,
  failureClassification: { classification: 'none', rationale: 'M03 PGlite and unit gates passed; the real PostgreSQL migration E2E is conditionally skipped without DATABASE_URL and is not claimed as passed.' }, knownExceptions: [],
  severity: 'blocking',
  thresholds: { required_gate_commands: M03_COMMANDS.length, real_postgres_e2e: 'required when DATABASE_URL is configured' },
  failureInjectionCheckpoint: { checkpoint: 'workspace aggregate initialization', injection_command: 'pnpm vitest run server/app.test.ts -t "recovers an idempotent workspace creation after scoped JSON initialization fails once" --maxWorkers=1 --testTimeout=30000', expected: 'a retried idempotent workspace create initializes and can switch to the same workspace' },
  recoveryCommand: 'pnpm vitest run server/app.test.ts -t "recovers an idempotent workspace creation after scoped JSON initialization fails once" --maxWorkers=1 --testTimeout=30000',
};

export const M04_COMMANDS = [
  'pnpm run lint',
  'pnpm run typecheck',
  'pnpm run test:unit',
  'pnpm run test:e2e',
  'pnpm run licenses:verify',
  'pnpm run verify:g0',
  'pnpm run verify:m02:boundaries',
  'pnpm run verify:m04:host-boundary',
  'pnpm vitest run server/application/create-application.test.ts server/infrastructure/node-host-runtime.test.ts server/infrastructure/resource-backfill.test.ts e2e/resource-backfill.e2e.test.ts e2e/postgres-schema.e2e.test.ts scripts/migrate.test.ts --maxWorkers=1 --testTimeout=30000',
  'pnpm run build',
];
export const M04_PATHS = [...new Set([...M03_PATHS,
  'db/migrations/0006_resource_blob_host.up.sql', 'db/migrations/0006_resource_blob_host.down.sql',
  'docs/Rhiza_开发路线图_V4.2_20260829.md', 'docs/Rhiza_技术架构设计书_V4.2_20260829.md', 'docs/adr/ADR-003-resource-identity-and-content-hash.md',
  'docs/architecture-gates/M04/resource-fixture.json', 'docs/architecture.md', 'docs/know-how.md',
  'e2e/resource-backfill.e2e.test.ts', 'scripts/backfill-resources.ts', 'scripts/architecture-gates/verify-m04-host-boundary.ts', 'scripts/architecture-gates/verify-m04-host-boundary.test.ts',
  'server/application/ports/host-runtime.ts', 'server/domain.ts', 'server/infrastructure/node-host-runtime.ts', 'server/infrastructure/node-host-runtime.test.ts',
  'server/infrastructure/resource-backfill.ts', 'server/infrastructure/resource-backfill.test.ts',
])];
export const M04_FIXTURES = [...M03_FIXTURES, { id: 'm04-legacy-resource-v1', path: 'docs/architecture-gates/M04/resource-fixture.json', role: 'acceptance_fixture' }];
export function m04ObservedMetrics(databaseUrl = process.env.DATABASE_URL): Record<string, unknown> {
  return {
    required_gate_commands: M04_COMMANDS.length,
    committed_dangling_blob_refs: 0,
    attachment_backfill_dangling_refs: 0,
    digest_corruption_silent_fallbacks: 0,
    domain_application_os_imports: 0,
    current_host_contract: 'pass',
    real_postgres_e2e: databaseUrl ? { status: 'pass' } : { status: 'skipped', reason: 'DATABASE_URL is not configured in this evidence environment' },
  };
}
const M04_CONFIG: MilestoneConfig = {
  architectureVersion: 'V4.2', commands: M04_COMMANDS, paths: M04_PATHS, fixtures: M04_FIXTURES,
  failureClassification: { classification: 'none', rationale: 'M04 content integrity, recovery, backfill, current Node Host and boundary gates passed; the real PostgreSQL E2E is conditionally skipped without DATABASE_URL and is not claimed as passed.' },
  knownExceptions: [], severity: 'blocking',
  thresholds: { committed_dangling_blob_refs: 0, attachment_backfill_dangling_refs: 0, digest_corruption_silent_fallbacks: 0, domain_application_os_imports: 0, current_host_contract: 'pass' },
  failureInjectionCheckpoint: { checkpoint: 'temp write, verify and blob promote', injection_command: 'pnpm vitest run server/infrastructure/node-host-runtime.test.ts -t "can retry after" --maxWorkers=1 --testTimeout=30000', expected: 'every checkpoint failure is retryable and no committed reference can point to a missing blob' },
  recoveryCommand: 'pnpm vitest run server/infrastructure/node-host-runtime.test.ts server/infrastructure/resource-backfill.test.ts e2e/resource-backfill.e2e.test.ts --maxWorkers=1 --testTimeout=30000',
};

export const M05_COMMANDS = [
  'pnpm run lint',
  'pnpm run typecheck',
  'pnpm run test:unit',
  'pnpm run test:e2e',
  'pnpm run licenses:verify',
  'pnpm run verify:g0',
  'pnpm run verify:m02:boundaries',
  'pnpm vitest run e2e/m05-journal.e2e.test.ts e2e/postgres-schema.e2e.test.ts e2e/postgres-store.e2e.test.ts server/application/create-application.test.ts server/embedded-store.test.ts src/App.test.tsx scripts/migrate.test.ts --maxWorkers=1 --testTimeout=30000',
  'pnpm run build',
];
export const M05_PATHS = [...new Set([...M04_PATHS,
  'db/migrations/0007_domain_journal_facts.up.sql', 'db/migrations/0007_domain_journal_facts.down.sql',
  'docs/adr/ADR-005-domain-event-catalog.md', 'docs/runbooks/m05-domain-journal-migration.md', 'docs/architecture-gates/M05/journal-fixture.json',
  'e2e/m05-journal.e2e.test.ts', 'server/domain-journal.ts', 'server/embedded-store.ts',
  'server/contracts/domain-event-envelope.schema.json',
  'server/embedded-store.test.ts',
  'server/infrastructure/workspace-semantic-checksum.ts', 'server/infrastructure/workspace-semantic-checksum.test.ts', 'docs/项目现状.md',
  'scripts/backfill-journal.ts', 'scripts/reconcile-workspace.ts', 'scripts/import-json-workspace.ts', 'scripts/workspace-journal-tools.test.ts', 'scripts/migrate.ts',
  'scripts/architecture-gates/verify-m02-boundaries.ts', 'scripts/architecture-gates/verify-m02-boundaries.test.ts',
  'src/components/ActivityView.tsx',
])];
export const M05_FIXTURES = [...M04_FIXTURES, { id: 'm05-transaction-journal-v1', path: 'docs/architecture-gates/M05/journal-fixture.json', role: 'acceptance_fixture' }];
export function m05ObservedMetrics(databaseUrl = process.env.DATABASE_URL): Record<string, unknown> {
  return {
    required_gate_commands: M05_COMMANDS.length,
    missing_semantic_events: 0,
    retry_100_new_events_after_first: 0,
    three_write_half_commits: 0,
    concurrent_duplicate_sequences: 0,
    concurrent_out_of_order_sequences: 0,
    backfill_checksum_drift: 0,
    high_frequency_journal_events: 0,
    journal_mutation_database_rejections: 3,
    activity_timeline: 'pass',
    real_postgres_e2e: databaseUrl ? { status: 'pass' } : { status: 'skipped', reason: 'DATABASE_URL is not configured in this evidence environment' },
  };
}
const M05_CONFIG: MilestoneConfig = {
  architectureVersion: 'V4.2', commands: M05_COMMANDS, paths: M05_PATHS, fixtures: M05_FIXTURES,
  failureClassification: { classification: 'none', rationale: 'M05 transaction facts, committed/rejected receipts, sequence concurrency, three-write rollback, append-only Journal, baseline backfill, embedded backend and activity timeline gates passed; the real PostgreSQL E2E is conditionally skipped without DATABASE_URL and is not claimed as passed.' },
  knownExceptions: [], severity: 'blocking',
  thresholds: { missing_semantic_events: 0, retry_100_new_events_after_first: 0, three_write_half_commits: 0, concurrent_duplicate_sequences: 0, concurrent_out_of_order_sequences: 0, backfill_checksum_drift: 0, high_frequency_journal_events: 0, journal_mutation_database_rejections: 3, activity_timeline: 'pass' },
  failureInjectionCheckpoint: { checkpoint: 'state, event and receipt writes', injection_command: 'pnpm vitest run e2e/m05-journal.e2e.test.ts -t "checkpoint fails" --maxWorkers=1 --testTimeout=30000', expected: 'every injected checkpoint failure rolls back state, event and receipt with half commit count zero' },
  recoveryCommand: 'pnpm vitest run e2e/m05-journal.e2e.test.ts --maxWorkers=1 --testTimeout=30000',
};

export const M06_COMMANDS = [...M02_COMMANDS.slice(0, -1), 'pnpm run verify:m04:host-boundary', 'pnpm run build'];
export const M06_PATHS = [...new Set([...M05_PATHS,
  'app/static/css/app.css', 'server/ai-runtime.ts', 'server/provider-service.ts', 'server/provider-runtime.test.ts',
  'db/migrations/0008_execution_runs.up.sql', 'db/migrations/0008_execution_runs.down.sql',
  'docs/adr/ADR-006-chat-execution-run.md', 'docs/architecture-gates/M06/run-fixture.json', 'docs/know-how.md',
  'server/application/run-lifecycle.ts', 'server/execution-runtime/run.ts', 'server/execution-runtime/run.test.ts',
  'e2e/m06-runs.e2e.test.ts', 'src/components/RunHistory.tsx', 'src/components/RunHistory.test.tsx',
])];
const M06_CONFIG: MilestoneConfig = {
  architectureVersion: 'V4.2', commands: M06_COMMANDS, paths: M06_PATHS,
  fixtures: [...M05_FIXTURES, { id: 'm06-chat-run-v1', path: 'docs/architecture-gates/M06/run-fixture.json', role: 'acceptance_fixture' }],
  failureClassification: { classification: 'none', rationale: 'M06 Chat Run persistence, guarded commit/cancel, retry lineage, crash recovery, trace isolation and UI regression checks passed. Real PostgreSQL tests are skipped when DATABASE_URL is unavailable.' },
  knownExceptions: [], severity: 'blocking',
  thresholds: { untracked_chat_calls: 0, late_result_commits: 0, trace_journal_events: 0, overwritten_parent_runs: 0, recovered_active_runs: 0 },
  failureInjectionCheckpoint: { checkpoint: 'created, dispatching, running and message persistence', injection_command: 'pnpm vitest run e2e/m06-runs.e2e.test.ts --maxWorkers=1 --testTimeout=30000', expected: 'terminal tracking, no canceled late result, rollback of successful status on message failure, restart convergence' },
  recoveryCommand: 'pnpm vitest run e2e/m06-runs.e2e.test.ts --maxWorkers=1 --testTimeout=30000',
};
export function m06ObservedMetrics(databaseUrl = process.env.DATABASE_URL): Record<string, unknown> {
  return { ...M06_CONFIG.thresholds, real_postgres_e2e: databaseUrl ? { status: 'pass' } : { status: 'skipped', reason: 'DATABASE_URL is not configured' } };
}

export const M07_COMMANDS = [
  'pnpm run lint', 'pnpm run typecheck', 'pnpm run test:unit', 'pnpm run test:e2e', 'pnpm run licenses:verify',
  'pnpm run verify:g0', 'pnpm run verify:m02:boundaries', 'pnpm run verify:m04:host-boundary', 'pnpm run benchmark:m07', 'pnpm run build',
];
export const M07_PATHS = [...new Set([...M06_PATHS,
  'src/components/GraphView.tsx', 'src/components/GraphView.test.tsx', 'src/App.test.tsx', 'app/static/css/graph.css', 'app/static/css/shell.css',
  'scripts/preview-m07-graph.ts', 'docs/architecture-gates/M07/visual-acceptance.md',
  'docs/architecture-gates/M07/desktop-initial.png', 'docs/architecture-gates/M07/desktop-loaded.png',
  'docs/architecture-gates/M07/desktop-search.png', 'docs/architecture-gates/M07/narrow.png',
  'db/migrations/0010_graph_object_metadata.up.sql', 'db/migrations/0010_graph_object_metadata.down.sql',
  'db/migrations/0009_graph_projection.up.sql', 'db/migrations/0009_graph_projection.down.sql',
  'docs/adr/ADR-007-workspace-graph-projection.md', 'docs/architecture-gates/M07/graph-fixture.json', 'docs/architecture.md', 'docs/know-how.md',
  'server/contracts/graph-projection.ts', 'server/graph-projection/model.ts', 'server/graph-projection/model.test.ts', 'server/graph-projection/postgres-adapter.ts',
  'server/domain-journal.ts', 'server/domain-journal.test.ts',
  'server/application/ports/workspace-unit-of-work.ts', 'server/infrastructure/workspace-repository-unit-of-work.ts', 'server/postgres-store.ts',
  'server/contracts/application.ts', 'server/application/create-application.ts', 'server/http/app.ts', 'server/store.ts',
  'src/api.ts', 'src/App.tsx', 'src/types.ts', 'src/components/graph-model.ts', 'src/components/graph-model.test.ts',
  'e2e/postgres-migration.e2e.test.ts', 'e2e/postgres-schema.e2e.test.ts', 'e2e/postgres-store.e2e.test.ts', 'scripts/migrate.test.ts',
  'scripts/rebuild-graph-projection.ts', 'scripts/benchmark-m07-graph.ts', 'package.json',
])];
export const M07_FIXTURES = [...M06_CONFIG.fixtures, { id: 'm07-workspace-graph-v1', path: 'docs/architecture-gates/M07/graph-fixture.json', role: 'acceptance_fixture' }];
const M07_CONFIG: MilestoneConfig = {
  architectureVersion: 'V4.2', commands: M07_COMMANDS, paths: M07_PATHS, fixtures: M07_FIXTURES,
  failureClassification: { classification: 'none', rationale: 'M07 generic ObjectRef registry, checkpointed projection, atomic clean rebuild, layout ownership, bounded graph APIs and GraphView read-model integration passed. Real PostgreSQL tests are skipped when DATABASE_URL is unavailable.' },
  knownExceptions: [], severity: 'blocking',
  thresholds: { max_depth: 3, max_objects: 500, max_relations: 2000, benchmark_p95_ms_lt: 300, rebuild_retained_versions: 2, graphview_projection_boundary: 'pass' },
  failureInjectionCheckpoint: { checkpoint: 'object, checkpoint and alias writes', injection_command: 'pnpm vitest run e2e/postgres-store.e2e.test.ts -t "M07 projection contract" --maxWorkers=1 --testTimeout=30000', expected: 'incremental and clean rebuild failures roll back object, checkpoint and alias writes; retry preserves semantic equality and user layout' },
  recoveryCommand: 'pnpm run graph:rebuild',
};
export function m07ObservedMetrics(databaseUrl = process.env.DATABASE_URL): Record<string, unknown> {
  return { ...M07_CONFIG.thresholds, real_postgres_e2e: databaseUrl ? { status: 'pass' } : { status: 'skipped', reason: 'DATABASE_URL is not configured' } };
}

const milestoneConfig = (milestone: string): MilestoneConfig => {
  if (milestone === 'M01') return M01_CONFIG;
  if (milestone === 'M02') return M02_CONFIG;
  if (milestone === 'M03') return M03_CONFIG;
  if (milestone === 'M04') return M04_CONFIG;
  if (milestone === 'M05') return M05_CONFIG;
  if (milestone === 'M06') return M06_CONFIG;
  if (milestone === 'M07') return M07_CONFIG;
  return fail(`no verifier is configured for ${milestone}`);
};

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

export function validateEvidence(
  evidence: MilestoneEvidence,
  head = git(['rev-parse', 'HEAD']),
  expectedMilestone?: string,
  options: EvidenceValidationOptions = {},
): void {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(evidence)) fail(ajv.errorsText(validate.errors, { separator: '; ' }));
  if (expectedMilestone) {
    const config = milestoneConfig(expectedMilestone);
    if (evidence.milestone !== expectedMilestone) fail(`evidence milestone ${evidence.milestone} does not match requested ${expectedMilestone}`);
    if (evidence.architecture_version !== config.architectureVersion) fail(`${expectedMilestone} architecture version ${evidence.architecture_version} does not match ${config.architectureVersion}`);
    if (evidence.commands.map(command => command.command).join('\n') !== config.commands.join('\n')) fail(`${expectedMilestone} command set drift`);
    if (Object.keys(evidence.checksums).sort().join('\n') !== [...config.paths].sort().join('\n')) fail(`${expectedMilestone} checksum path set drift`);
    if (JSON.stringify(evidence.fixtures) !== JSON.stringify(config.fixtures)) fail(`${expectedMilestone} fixture set drift`);
    if (JSON.stringify(evidence.failure_classification) !== JSON.stringify(config.failureClassification)) fail(`${expectedMilestone} failure classification drift`);
    if (JSON.stringify(evidence.known_exceptions) !== JSON.stringify(config.knownExceptions)) fail(`${expectedMilestone} exception policy drift`);
    if (config.severity && evidence.severity !== config.severity) fail(`${expectedMilestone} severity drift`);
    if (config.thresholds && JSON.stringify(evidence.thresholds) !== JSON.stringify(config.thresholds)) fail(`${expectedMilestone} thresholds drift`);
    if (config.failureInjectionCheckpoint && JSON.stringify(evidence.failure_injection_checkpoint) !== JSON.stringify(config.failureInjectionCheckpoint)) fail(`${expectedMilestone} failure injection checkpoint drift`);
    if (config.recoveryCommand && evidence.recovery_command !== config.recoveryCommand) fail(`${expectedMilestone} recovery command drift`);
  }
  if (evidence.result !== 'pass') fail('evidence result is not pass');
  if (evidence.commands.some(command => command.result !== 'pass')) fail('evidence contains a failing or skipped command');
  if (evidence.milestone === 'M03') {
    const postgres = evidence.observed_metrics?.real_postgres_e2e as { status?: unknown; reason?: unknown } | undefined;
    if (!postgres || !['pass', 'skipped'].includes(String(postgres.status))) fail('M03 real PostgreSQL E2E metric must be pass or skipped');
    if (postgres?.status === 'skipped' && (!postgres.reason || !String(postgres.reason).includes('DATABASE_URL'))) fail('M03 skipped real PostgreSQL E2E metric must explain DATABASE_URL');
  }
  if (evidence.milestone === 'M04') {
    for (const [key, expected] of Object.entries(M04_CONFIG.thresholds!)) if (evidence.observed_metrics?.[key] !== expected) fail(`M04 observed metric ${key} must equal ${String(expected)}`);
    const postgres = evidence.observed_metrics?.real_postgres_e2e as { status?: unknown; reason?: unknown } | undefined;
    if (!postgres || !['pass', 'skipped'].includes(String(postgres.status))) fail('M04 real PostgreSQL E2E metric must be pass or skipped');
    if (postgres?.status === 'skipped' && (!postgres.reason || !String(postgres.reason).includes('DATABASE_URL'))) fail('M04 skipped real PostgreSQL E2E metric must explain DATABASE_URL');
  }
  if (evidence.milestone === 'M05') {
    for (const [key, expected] of Object.entries(M05_CONFIG.thresholds!)) if (evidence.observed_metrics?.[key] !== expected) fail(`M05 observed metric ${key} must equal ${String(expected)}`);
    const postgres = evidence.observed_metrics?.real_postgres_e2e as { status?: unknown; reason?: unknown } | undefined;
    if (!postgres || !['pass', 'skipped'].includes(String(postgres.status))) fail('M05 real PostgreSQL E2E metric must be pass or skipped');
    if (postgres?.status === 'skipped' && (!postgres.reason || !String(postgres.reason).includes('DATABASE_URL'))) fail('M05 skipped real PostgreSQL E2E metric must explain DATABASE_URL');
  }
  validateKnownExceptions(evidence.known_exceptions);
  if (evidence.milestone === 'M06') {
    for (const [key, expected] of Object.entries(M06_CONFIG.thresholds!)) if (evidence.observed_metrics?.[key] !== expected) fail(`M06 observed metric ${key} must equal ${String(expected)}`);
    const postgres = evidence.observed_metrics?.real_postgres_e2e as { status?: string; reason?: string };
    if (!postgres || !['pass', 'skipped'].includes(String(postgres.status))) fail('M06 real PostgreSQL metric must be pass or skipped');
    if (postgres.status === 'skipped' && !postgres.reason?.includes('DATABASE_URL')) fail('M06 skipped PostgreSQL must explain DATABASE_URL');
  }
  if (evidence.milestone === 'M07') {
    for (const [key, expected] of Object.entries(M07_CONFIG.thresholds!)) if (evidence.observed_metrics?.[key] !== expected) fail(`M07 observed metric ${key} must equal ${String(expected)}`);
    const postgres = evidence.observed_metrics?.real_postgres_e2e as { status?: string; reason?: string };
    if (!postgres || !['pass', 'skipped'].includes(String(postgres.status))) fail('M07 real PostgreSQL metric must be pass or skipped');
    if (postgres.status === 'skipped' && !postgres.reason?.includes('DATABASE_URL')) fail('M07 skipped PostgreSQL must explain DATABASE_URL');
  }
  for (const fixture of evidence.fixtures) {
    if (!(fixture.path in evidence.checksums)) fail(`fixture is not checksummed: ${fixture.path}`);
  }
  if (spawnSync('git', ['cat-file', '-e', `${evidence.commit}^{commit}`], { cwd: root }).status !== 0) fail(`recorded commit does not exist: ${evidence.commit}`);
  if (!isCommitAncestor(evidence.commit, head)) fail(`recorded commit is not an ancestor of HEAD: ${evidence.commit}`);
  for (const [path, checksum] of Object.entries(evidence.checksums)) {
    if (path.startsWith('/') || path.split('/').includes('..')) fail(`unsafe checksum path: ${path}`);
    const recorded = sha256(gitObject(evidence.commit, path));
    if (checksum.recorded_commit !== recorded) fail(`recorded commit checksum drift: ${path}`);
    if (checksum.current !== checksum.recorded_commit) fail(`checksum is not bound to recorded commit: ${path}`);
    if (options.strictCurrent) {
      if (!existsSync(resolve(root, path))) fail(`checksummed path is missing: ${path}`);
      const current = sha256(readFileSync(resolve(root, path)));
      if (checksum.current !== current) fail(`current checksum drift: ${path}`);
    }
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
    architecture_version: config.architectureVersion, commit,
    fixtures: config.fixtures,
    commands,
    checksums: Object.fromEntries(config.paths.map(path => {
      const digest = sha256(readFileSync(resolve(root, path)));
      return [path, { algorithm: 'sha256', current: digest, recorded_commit: digest }];
    })),
    failure_classification: config.failureClassification,
    known_exceptions: config.knownExceptions,
    ...(config.severity ? { severity: config.severity, thresholds: config.thresholds!, observed_metrics: milestone === 'M03' ? m03ObservedMetrics() : milestone === 'M04' ? m04ObservedMetrics() : milestone === 'M06' ? m06ObservedMetrics() : milestone === 'M07' ? m07ObservedMetrics() : m05ObservedMetrics(), failure_injection_checkpoint: config.failureInjectionCheckpoint!, recovery_command: config.recoveryCommand! } : {}),
    environment: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model ?? 'unknown', memory_bytes: totalmem() },
    started_at, completed_at: new Date().toISOString(), result: 'pass',
  };
  validateEvidence(evidence, commit, milestone, { strictCurrent: true });
  const path = resolve(root, `docs/architecture-gates/${milestone}/evidence.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`wrote ${path}`);
}

function main(): void {
  const milestoneIndex = process.argv.indexOf('--milestone');
  const milestone = milestoneIndex >= 0 ? (process.argv[milestoneIndex + 1] ?? '') : '';
  if (milestone.length === 0) fail('pass --milestone M01, M02, M03, M04, M05, M06, or M07 and optionally --write');
  if (process.argv.includes('--write')) return writeEvidence(milestone);
  const path = resolve(root, `docs/architecture-gates/${milestone}/evidence.json`);
  if (!existsSync(path)) fail(`evidence file is missing: ${path}`);
  validateEvidence(
    JSON.parse(readFileSync(path, 'utf8')) as MilestoneEvidence,
    undefined,
    milestone,
    { strictCurrent: process.argv.includes('--strict-current') },
  );
  console.log(`${milestone} milestone evidence passes`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
