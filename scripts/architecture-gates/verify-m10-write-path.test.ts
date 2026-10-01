import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { inspectLegacyWriteCallers } from './verify-m10-write-path';

it('rejects a newly introduced Workspace write caller but permits unrelated provider storage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-write-scan-'));
  try {
    await writeFile(join(root, 'caller.ts'), `interface WorkspaceData { discussionNodes: unknown[] }
      declare const repository: { read(): Promise<WorkspaceData>; update(input: unknown): void };
      declare const provider: { read(): Promise<{ models: unknown[] }>; update(input: unknown): void };
      repository.update(null); provider.update(null);`);
    const report = await inspectLegacyWriteCallers(root);
    expect(report.ok).toBe(false);
    expect(report.calls).toEqual([expect.objectContaining({ file: 'caller.ts', allowed: false })]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
