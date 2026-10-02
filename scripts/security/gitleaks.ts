import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
interface ToolLock { version: string; checksumsSha256: string; assets: Record<string, { file: string; sha256: string }> }
const lock: ToolLock = JSON.parse(await readFile(new URL('../../tools/gitleaks.lock.json',import.meta.url),'utf8'));
const platform = `${process.platform}-${process.arch}`;
const directory = resolve('.rhiza/tools/gitleaks',lock.version,platform);
const archive = join(directory,'release.tar.gz');
const binary = join(directory,'gitleaks');
const checksumFile = join(directory,'checksums.txt');
const releaseBase = `https://github.com/gitleaks/gitleaks/releases/download/v${lock.version}`;

export function verifyChecksum(bytes: Uint8Array, expected: string) {
  if (!/^[a-f0-9]{64}$/.test(expected) || hash(bytes) !== expected) throw new Error('TOOL_CHECKSUM_MISMATCH');
}
async function download(file: string, sha256: string) {
  // curl follows the host's working proxy setup; native fetch timed out on release asset redirects here.
  let bytes: Buffer;
  try {
    const result = await execute('curl',['--fail','--silent','--show-error','--location','--max-time','30','--max-filesize','33554432',`${releaseBase}/${file}`],
      { encoding: 'buffer', timeout: 35000, maxBuffer: 32 * 1024 ** 2 });
    bytes = result.stdout;
  } catch (error) { throw new Error('TOOL_DOWNLOAD_FAILED',{ cause: error }); }
  verifyChecksum(bytes,sha256); return bytes;
}
function asset() {
  if (lock.version !== '8.30.1' || !lock.assets[platform]) throw new Error('UNSUPPORTED_PINNED_TOOL_PLATFORM');
  return lock.assets[platform];
}
async function archiveMember(name: 'gitleaks' | 'LICENSE') {
  const { stdout } = await execute('tar',['-xOf',archive,name],{ encoding: 'buffer', maxBuffer: 64 * 1024 ** 2, timeout: 30000 });
  return stdout;
}
export async function installGitleaks() {
  const selected = asset();
  const checksums = await download(`gitleaks_${lock.version}_checksums.txt`,lock.checksumsSha256);
  if (!checksums.toString().split('\n').includes(`${selected.sha256}  ${selected.file}`)) throw new Error('TOOL_CHECKSUM_MANIFEST_MISMATCH');
  const bytes = await download(selected.file,selected.sha256);
  await mkdir(directory,{ recursive: true, mode: 0o700 });
  await writeFile(archive,bytes,{ mode: 0o600 }); await writeFile(checksumFile,checksums,{ mode: 0o600 });
  // Extract only stdout from a verified archive; archive paths never write to the filesystem.
  await writeFile(binary,await archiveMember('gitleaks'),{ mode: 0o700 }); await chmod(binary,0o700);
  await writeFile(join(directory,'LICENSE'),await archiveMember('LICENSE'),{ mode: 0o600 });
  await verifiedBinary(); return { ok: true, tool: 'gitleaks', version: lock.version, platform, checksumVerified: true };
}
async function verifiedBinary() {
  const selected = asset();
  let checksums: Buffer; let bytes: Buffer;
  try { checksums = await readFile(checksumFile); bytes = await readFile(archive); } catch { throw new Error('GITLEAKS_NOT_INSTALLED'); }
  verifyChecksum(checksums,lock.checksumsSha256); verifyChecksum(bytes,selected.sha256);
  verifyChecksum(await readFile(binary),hash(await archiveMember('gitleaks')));
  const { stdout } = await execute(binary,['version'],{ timeout: 5000, maxBuffer: 1024 });
  if (stdout.trim() !== lock.version) throw new Error('TOOL_VERSION_MISMATCH');
  return binary;
}
export function sanitizedFindings(raw: unknown) {
  if (!Array.isArray(raw)) throw new Error('INVALID_SCAN_REPORT');
  return raw.map(row => {
    if (!row || typeof row.RuleID !== 'string' || typeof row.File !== 'string' || !Number.isSafeInteger(row.StartLine) || row.StartLine < 1) throw new Error('INVALID_SCAN_REPORT');
    // Even filenames can contain credentials. Hash location and rule references; never copy detector text.
    return { ruleRef: hash(row.RuleID), fileRef: hash(row.File), line: row.StartLine };
  });
}
export interface HistoryFindingReview {
  ruleRef: string; fileRef: string; commit: string; line: number; endLine: number; sourceBlobDigest: string;
  kind: 'public-version-literal' | 'public-config-assignment';
}
/** Explicit decisions bind immutable historical locations, never a filename, rule or value wildcard. */
export function classifyHistoryFindings(raw: unknown, mode: 'git' | 'dir', reviews: readonly HistoryFindingReview[]) {
  const safe = sanitizedFindings(raw);
  const records = raw as Array<{ Commit?: unknown; EndLine?: unknown }>;
  let reviewedFindingCount = 0;
  const findings = safe.map((finding, index) => {
    const row = records[index];
    const review = mode === 'git' ? reviews.find(review => review.ruleRef === finding.ruleRef && review.fileRef === finding.fileRef
      && review.line === finding.line && review.endLine === row.EndLine && review.commit === row.Commit) : undefined;
    if (!review) return finding;
    reviewedFindingCount++;
    return { ...finding, review: { kind: review.kind, commitRef: hash(review.commit), sourceBlobDigest: review.sourceBlobDigest } };
  });
  return { findings, reviewedFindingCount, unreviewedFindingCount: findings.length - reviewedFindingCount };
}
export function parseHistoryFindingReviews(input: unknown): HistoryFindingReview[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_HISTORY_REVIEW');
  const value = input as { schemaVersion?: unknown; toolVersion?: unknown; reviews?: unknown };
  const hex = (entry: unknown, length: number) => typeof entry === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(entry);
  const keys = ['ruleRef', 'fileRef', 'commit', 'line', 'endLine', 'sourceBlobDigest', 'kind'];
  if (!value || value.schemaVersion !== '1.0.0' || value.toolVersion !== lock.version || !Array.isArray(value.reviews) || value.reviews.length > 100
    || Object.keys(value).some(key => !['schemaVersion', 'toolVersion', 'reviews'].includes(key))) throw new Error('INVALID_HISTORY_REVIEW');
  const identities = new Set<string>();
  for (const review of value.reviews) {
    if (!review || typeof review !== 'object' || Array.isArray(review) || Object.keys(review).some(key => !keys.includes(key))
      || !hex(review.ruleRef, 64) || !hex(review.fileRef, 64) || !hex(review.commit, 40) || !hex(review.sourceBlobDigest, 64)
      || !Number.isSafeInteger(review.line) || review.line < 1 || !Number.isSafeInteger(review.endLine) || review.endLine < review.line
      || !['public-version-literal', 'public-config-assignment'].includes(review.kind)) throw new Error('INVALID_HISTORY_REVIEW');
    const identity = JSON.stringify([review.ruleRef, review.fileRef, review.commit, review.line, review.endLine]);
    if (identities.has(identity)) throw new Error('INVALID_HISTORY_REVIEW');
    identities.add(identity);
  }
  return value.reviews as HistoryFindingReview[];
}
async function historyFindingReviews(): Promise<HistoryFindingReview[]> {
  return parseHistoryFindingReviews(JSON.parse(await readFile(new URL('../../tools/security-history-reviews.json', import.meta.url), 'utf8')));
}
export async function scanSecrets(target: string, mode: 'git' | 'dir' = 'git') {
  const tool = await verifiedBinary();
  const reviews = mode === 'git' ? await historyFindingReviews() : [];
  const temporary = await mkdtemp(join(tmpdir(),'rhiza-safe-scan-'));
  try {
    const report = join(temporary,'raw.json'); const config = join(temporary,'rules.toml'); const ignore = join(temporary,'ignore');
    await writeFile(config,'[extend]\nuseDefault = true\n',{ mode: 0o600 }); await writeFile(ignore,'',{ mode: 0o600 });
    const args = [mode,resolve(target),'--config',config,'--gitleaks-ignore-path',ignore,'--ignore-gitleaks-allow','--redact=100','--no-banner','--no-color','--exit-code=23','--max-archive-depth=1','--max-decode-depth=2','--timeout=30','--report-format=json','--report-path',report];
    let status = 0;
    try { await execute(tool,args,{ timeout: 35000, maxBuffer: 2 * 1024 ** 2 }); }
    catch (error) { status = Number((error as { code?: number }).code ?? 1); }
    if (![0,23].includes(status)) throw new Error('SCAN_EXECUTION_FAILED');
    const { findings, reviewedFindingCount, unreviewedFindingCount } = classifyHistoryFindings(JSON.parse(await readFile(report,'utf8')), mode, reviews);
    if ((status === 0) !== (findings.length === 0)) throw new Error('INCONSISTENT_SCAN_REPORT');
    return { schemaVersion: '1.0.0', ok: unreviewedFindingCount === 0, code: unreviewedFindingCount ? 'SECRET_FINDINGS' : findings.length ? 'REVIEWED_HISTORY_FINDINGS' : 'SCAN_CLEAN', tool: 'gitleaks', version: lock.version, checksumVerified: true,
      scope: mode, coverage: { maxArchiveDepth: 1, maxDecodeDepth: 2, timeoutSeconds: 30 }, findingCount: findings.length, reviewedFindingCount, unreviewedFindingCount, findings };
  } finally { await rm(temporary,{ recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = process.argv[2] === 'install' ? await installGitleaks() : await scanSecrets(process.argv[3] ?? '.',process.argv[2] === 'dir' ? 'dir' : 'git');
    console.info(JSON.stringify(result)); if (!result.ok) process.exitCode = 1;
  } catch (error) {
    const allowed = ['TOOL_DOWNLOAD_FAILED','TOOL_CHECKSUM_MISMATCH','TOOL_CHECKSUM_MANIFEST_MISMATCH','GITLEAKS_NOT_INSTALLED','UNSUPPORTED_PINNED_TOOL_PLATFORM','TOOL_VERSION_MISMATCH','INVALID_SCAN_REPORT','INVALID_HISTORY_REVIEW','SCAN_EXECUTION_FAILED'];
    console.error(JSON.stringify({ ok: false, code: error instanceof Error && allowed.includes(error.message) ? error.message : 'SECURITY_CHECK_FAILED' })); process.exitCode = 1;
  }
}
