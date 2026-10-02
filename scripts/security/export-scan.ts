import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stagePortableWorkspace } from '../../server/infrastructure/portable-content';
import { scanSecrets } from './gitleaks';

/** Gitleaks does not expand .rhiza by extension. Validate and scan the actual portable bytes. */
export async function scanWorkspaceBundle(target: string) {
  const staged = await stagePortableWorkspace(resolve(target));
  try {
    const report = await scanSecrets(staged.directory, 'dir');
    return { ...report, scope: 'bundle' as const, validated: true, expandedEntries: staged.index.entries.length + 1 };
  } finally { await staged.dispose(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('BUNDLE_PATH_REQUIRED');
    const result = await scanWorkspaceBundle(process.argv[2]);
    console.info(JSON.stringify(result)); if (!result.ok) process.exitCode = 1;
  } catch (error) {
    const allowed = ['BUNDLE_PATH_REQUIRED', 'GITLEAKS_NOT_INSTALLED', 'UNSUPPORTED_PINNED_TOOL_PLATFORM', 'TOOL_VERSION_MISMATCH',
      'TOOL_CHECKSUM_MISMATCH', 'INVALID_SCAN_REPORT', 'INCONSISTENT_SCAN_REPORT', 'SCAN_EXECUTION_FAILED'];
    const code = error instanceof Error && allowed.includes(error.message) ? error.message
      : error instanceof Error && 'code' in error && String(error.code).startsWith('BUNDLE_') ? 'BUNDLE_VALIDATION_FAILED' : 'SECURITY_EXPORT_FAILED';
    console.error(JSON.stringify({ ok: false, code })); process.exitCode = 1;
  }
}
