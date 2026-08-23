import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const mapPath = resolve(root, 'docs/architecture-gates/G0/characterization-map.json');

type Coverage = { behavior: string; file: string; title: string };

const map = JSON.parse(await readFile(mapPath, 'utf8')) as { coverage: Coverage[] };
const byFile = new Map<string, string[]>();
for (const item of map.coverage) {
  const titles = byFile.get(item.file) ?? [];
  titles.push(item.title);
  byFile.set(item.file, titles);
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const [file, titles] of byFile) {
  const source = await readFile(resolve(root, file), 'utf8');
  for (const title of titles) {
    if (!source.includes(`it('${title}'`)) throw new Error(`Missing mapped characterization: ${file} :: ${title}`);
  }
  const titlePattern = `(?:${titles.map(escapeRegex).join('|')})$`;
  execFileSync('pnpm', ['exec', 'vitest', 'run', file, '-t', titlePattern, '--maxWorkers=1', '--testTimeout=30000'], {
    cwd: root,
    stdio: 'inherit',
  });
}
