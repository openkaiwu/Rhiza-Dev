import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type HygieneFinding = {
  path: string;
  rule: 'prohibited-artifact' | 'secret' | 'absolute-path';
  detail: string;
};

const prohibitedArtifact = /(?:^|\/)(?:\.DS_Store|Rhiza-Dev-codex-rhiza-librechat-runtime\.zip)$/;
const prohibitedRuntimeSnapshot = /^Rhiza-Dev-codex-rhiza-librechat-runtime\//;
const secretPatterns: Array<[string, RegExp]> = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['GitHub token', /gh[pousr]_[A-Za-z0-9]{30,}/],
  ['OpenAI-style token', /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/],
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['Slack token', /xox[baprs]-[A-Za-z0-9-]{20,}/],
  ['Bearer token', /Bearer\s+[A-Za-z0-9._-]{20,}/],
];
const absolutePathPatterns: Array<[string, RegExp]> = [
  ['file URL', /file:\/\/\/[A-Za-z0-9_.~/%-]+/i],
  ['POSIX home path', /\/(?:Users|home)\/[A-Za-z0-9_.-]+(?:\/|$)/],
  ['private or tmp path', /\/(?:private|tmp)\/[A-Za-z0-9_.-]+(?:\/|$)/],
  ['Windows drive path', /[A-Za-z]:\\(?:Users|home|Temp)\\[A-Za-z0-9_.-]+(?:\\|$)/],
  ['UNC path', /\\\\[A-Za-z0-9_.-]+\\[A-Za-z0-9_.-]+/],
];

export function scanTrackedContent(path: string, content: string): HygieneFinding[] {
  const findings: HygieneFinding[] = [];
  for (const [detail, pattern] of secretPatterns) {
    if (pattern.test(content)) findings.push({ path, rule: 'secret', detail });
  }
  for (const [detail, pattern] of absolutePathPatterns) {
    if (pattern.test(content)) findings.push({ path, rule: 'absolute-path', detail });
  }
  return findings;
}

export async function scanTrackedFiles(root: string): Promise<HygieneFinding[]> {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'buffer' })
    .toString('utf8').split('\0').filter(Boolean).sort();
  const findings: HygieneFinding[] = [];
  for (const path of tracked) {
    if (prohibitedArtifact.test(path) || prohibitedRuntimeSnapshot.test(path)) {
      findings.push({ path, rule: 'prohibited-artifact', detail: 'tracked runtime artifact' });
      continue;
    }
    const content = await readFile(resolve(root, path));
    if (content.includes(0)) continue;
    findings.push(...scanTrackedContent(path, content.toString('utf8')));
  }
  return findings.sort((left, right) => `${left.path}:${left.rule}:${left.detail}`.localeCompare(`${right.path}:${right.rule}:${right.detail}`));
}

async function run(): Promise<void> {
  const root = resolve(import.meta.dirname, '../..');
  const findings = await scanTrackedFiles(root);
  if (findings.length) {
    throw new Error(`Repository hygiene failed:\n${findings.map(finding => `${finding.path}: ${finding.rule} (${finding.detail})`).join('\n')}`);
  }
  console.log('Repository hygiene passed: tracked files contain no prohibited artifacts, secrets, or absolute paths.');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  run().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
