import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Check = { id: string; script?: string; files?: string[]; filter?: string; requiredFiles?: string[] };
type ProcessResult = { status: number | null; signal: string | null; error?: Error };
type CheckResult = { id: string; command: string[]; status: 'passed' | 'failed' | 'missing'; exitCode: number | null; signal?: string | null; error?: string };
type Report = { schemaVersion: string; milestone: string; scope: 'engineering_checks'; ok: boolean; checks: CheckResult[]; formalGate: { status: 'pending'; unverified: string[] }; error?: string };

// These are engineering entry points. They do not close the formal milestone Gates.
const milestones: Record<string, { checks: Check[]; unverified: string[] }> = {
  m15: {
    checks: [
      { id: 'context', files: ['server/application/m15-context.test.ts', 'server/context-runtime/m15-modes.test.ts', 'server/infrastructure/context-compiler.test.ts', 'e2e/m15-context.e2e.test.ts'] },
      { id: 'history', files: ['server/infrastructure/context-history.test.ts', 'server/provenance/model.test.ts', 'src/components/ContextHistoryPanel.test.tsx', 'src/components/MessageProvenance.test.tsx'] },
      { id: 'replay', files: ['e2e/m06-runs.e2e.test.ts'], filter: 'M09 replays frozen inputs explicitly|M09 provenance audit' },
      { id: 'resource_versions', files: ['server/application/create-application.test.ts', 'e2e/m15-resource-version.e2e.test.ts', 'src/components/ResourceView.test.tsx'] },
    ],
    unverified: ['production_context_provenance_replay_acceptance', 'live_provider_and_multimodal_attachment_evidence'],
  },
  m16: {
    checks: [
      { id: 'providers', files: ['server/provider-service.test.ts', 'server/provider-runtime.test.ts', 'src/components/ProviderSettings.test.tsx'] },
      { id: 'collaboration', script: 'm16:collaboration:checks' },
      { id: 'backups', script: 'm16:backups:checks' },
      { id: 'portability', files: ['server/domain/portable-bundle.test.ts', 'server/infrastructure/portable-workspace.test.ts', 'server/infrastructure/portable-semantic-schema.test.ts', 'server/infrastructure/portable-external-resources.test.ts', 'server/infrastructure/portable-hydration.test.ts', 'server/infrastructure/bundle-hydration-upload.test.ts', 'server/application/bundle-execution-preflight.test.ts', 'e2e/m16-external-bundle.e2e.test.ts', 'e2e/m09-default-bundle.e2e.test.ts'] },
      { id: 'security', script: 'security:checks' },
    ],
    unverified: ['live_provider_and_multimodal_attachment_evidence', 'production_restore_and_retention_expiry', 'security_ci_and_deployment_artifact_evidence'],
  },
  m17: {
    checks: [
      // Reevaluate the recorded samples; do not run benchmark:m17 here.
      { id: 'performance', script: 'm17:performance:status', requiredFiles: ['scripts/m17-performance-status.ts', 'reports/m15-m18/performance.json', 'reports/m15-m18/m17-matrix.json'] },
      { id: 'recovery', script: 'm17:recovery:checks' },
      { id: 'stream_faults', files: ['e2e/m16-collaboration-stream.e2e.test.ts'] },
      { id: 'run_faults', files: ['e2e/m06-runs.e2e.test.ts'], filter: 'records provider errors and missing RUN_END|cancels an uncooperative running provider|rolls back a successful terminal transition' },
      { id: 'storage_faults', files: ['e2e/m17-storage-faults.e2e.test.ts'] },
    ],
    unverified: ['production_full_storage_and_fault_recovery', 'comparable_g0_performance_baseline', 'production_ui_acceptance', 'continuous_browser_60_minutes', 'dogfood_4_calendar_weeks', 'new_users_3_completion_80_percent'],
  },
  m18: {
    checks: [
      { id: 'views', script: 'm18:views:checks' },
      { id: 'batches', script: 'm18:batches:checks' },
      { id: 'navigation_ui', files: ['src/navigation.test.ts', 'src/App.test.tsx', 'src/api.test.ts', 'src/components/AppShell.test.tsx', 'src/components/GraphView.test.tsx', 'src/components/RunHistory.test.tsx', 'src/components/BundleControls.test.tsx', 'src/components/CollaborationCard.test.tsx', 'e2e/m15-ui-client.e2e.test.ts'] },
    ],
    unverified: ['production_visual_keyboard_narrow_screen_acceptance', 'm17_formal_dependency_gate'],
  },
};

export function runMilestoneChecks(milestone: string, dependencies: {
  scripts: Record<string, unknown>;
  run?: (args: string[]) => ProcessResult;
  fileExists?: (file: string) => boolean;
}) {
  const report: Report = { schemaVersion: '1.0.0', milestone, scope: 'engineering_checks', ok: false, checks: [], formalGate: { status: 'pending', unverified: [] } };
  const plan = Object.hasOwn(milestones, milestone) ? milestones[milestone] : undefined;
  if (!plan) return { report: { ...report, error: 'UNKNOWN_MILESTONE' }, exitCode: 1 };
  report.formalGate.unverified = [...plan.unverified];
  const fileExists = dependencies.fileExists ?? existsSync;
  const run = dependencies.run ?? ((args: string[]) => spawnSync('pnpm', args, { stdio: ['ignore', 2, 2] }));
  for (const check of plan.checks) {
    const args = check.script ? ['run', check.script] : ['exec', 'vitest', 'run', ...check.files!, ...(check.filter ? ['-t', check.filter] : []), '--maxWorkers=1', '--testTimeout=30000'];
    const command = ['pnpm', ...args];
    const script = check.script && dependencies.scripts[check.script];
    const missing = check.script && (typeof script !== 'string' || !script.trim()) ? `MISSING_SCRIPT:${check.script}`
      : [...(check.files ?? []), ...(check.requiredFiles ?? [])].find(file => !fileExists(file));
    if (missing) {
      report.checks.push({ id: check.id, command, status: 'missing', exitCode: null, error: missing.startsWith('MISSING_SCRIPT:') ? missing : `MISSING_FILE:${missing}` });
      continue;
    }
    try {
      const result = run(args);
      const passed = result.status === 0 && result.signal === null && !result.error;
      report.checks.push({ id: check.id, command, status: passed ? 'passed' : 'failed', exitCode: result.status, signal: result.signal, ...(result.error ? { error: 'CHECK_PROCESS_ERROR' } : {}) });
    } catch {
      report.checks.push({ id: check.id, command, status: 'failed', exitCode: null, error: 'CHECK_PROCESS_ERROR' });
    }
  }
  report.ok = report.checks.length > 0 && report.checks.every(check => check.status === 'passed');
  return { report, exitCode: report.ok ? 0 : 1 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, unknown> };
    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) throw new Error('CHECK_CONFIGURATION_UNAVAILABLE');
    const result = runMilestoneChecks(process.argv[2] ?? '', { scripts });
    console.info(JSON.stringify(result.report));
    process.exitCode = result.exitCode;
  } catch {
    console.info(JSON.stringify({ schemaVersion: '1.0.0', scope: 'engineering_checks', ok: false, error: 'CHECK_CONFIGURATION_UNAVAILABLE', formalGate: { status: 'pending' } }));
    process.exitCode = 1;
  }
}
