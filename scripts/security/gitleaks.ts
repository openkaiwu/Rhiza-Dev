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
export async function scanSecrets(target: string, mode: 'git' | 'dir' = 'git') {
  const tool = await verifiedBinary();
  const temporary = await mkdtemp(join(tmpdir(),'rhiza-safe-scan-'));
  try {
    const report = join(temporary,'raw.json'); const config = join(temporary,'rules.toml'); const ignore = join(temporary,'ignore');
    await writeFile(config,'[extend]\nuseDefault = true\n',{ mode: 0o600 }); await writeFile(ignore,'',{ mode: 0o600 });
    const args = [mode,resolve(target),'--config',config,'--gitleaks-ignore-path',ignore,'--ignore-gitleaks-allow','--redact=100','--no-banner','--no-color','--exit-code=23','--max-archive-depth=1','--max-decode-depth=2','--timeout=30','--report-format=json','--report-path',report];
    let status = 0;
    try { await execute(tool,args,{ timeout: 35000, maxBuffer: 2 * 1024 ** 2 }); }
    catch (error) { status = Number((error as { code?: number }).code ?? 1); }
    if (![0,23].includes(status)) throw new Error('SCAN_EXECUTION_FAILED');
    const findings = sanitizedFindings(JSON.parse(await readFile(report,'utf8')));
    if ((status === 0) !== (findings.length === 0)) throw new Error('INCONSISTENT_SCAN_REPORT');
    return { schemaVersion: '1.0.0', ok: findings.length === 0, code: findings.length ? 'SECRET_FINDINGS' : 'SCAN_CLEAN', tool: 'gitleaks', version: lock.version, checksumVerified: true,
      scope: mode, coverage: { maxArchiveDepth: 1, maxDecodeDepth: 2, timeoutSeconds: 30 }, findingCount: findings.length, findings };
  } finally { await rm(temporary,{ recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = process.argv[2] === 'install' ? await installGitleaks() : await scanSecrets(process.argv[3] ?? '.',process.argv[2] === 'dir' ? 'dir' : 'git');
    console.info(JSON.stringify(result)); if (!result.ok) process.exitCode = 1;
  } catch (error) {
    const allowed = ['TOOL_DOWNLOAD_FAILED','TOOL_CHECKSUM_MISMATCH','TOOL_CHECKSUM_MANIFEST_MISMATCH','GITLEAKS_NOT_INSTALLED','UNSUPPORTED_PINNED_TOOL_PLATFORM','TOOL_VERSION_MISMATCH','INVALID_SCAN_REPORT','SCAN_EXECUTION_FAILED'];
    console.error(JSON.stringify({ ok: false, code: error instanceof Error && allowed.includes(error.message) ? error.message : 'SECURITY_CHECK_FAILED' })); process.exitCode = 1;
  }
}
