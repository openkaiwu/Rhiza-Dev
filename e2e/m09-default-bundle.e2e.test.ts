// @vitest-environment node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';

it('exports the default Workspace on first startup and again after a restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rhiza-default-bundle-'));
  const portServer = createServer();
  await new Promise<void>(done => portServer.listen(0, '127.0.0.1', done));
  const address = portServer.address();
  if (!address || typeof address === 'string') throw new Error('TEST_PORT_UNAVAILABLE');
  const port = address.port;
  await new Promise<void>(done => portServer.close(() => done()));
  const url = `http://127.0.0.1:${port}/api/v1/workspaces/00000000-0000-4000-8000-000000000001/bundle`;
  const start = () => spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: resolve(import.meta.dirname, '..'), stdio: 'ignore', env: { ...process.env, DATABASE_URL: '', API_PORT: String(port),
      RHIZA_EMBEDDED_DATA_DIR: join(directory, 'data'), RHIZA_UPLOAD_DIR: join(directory, 'uploads'), SERVE_FRONTEND: 'false' },
  });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const child = start();
      try {
        await vi.waitFor(async () => expect((await fetch(url)).status).toBe(200), { timeout: 30_000, interval: 200 });
        const response = await fetch(url);
        expect(response.headers.get('content-type')).toContain('application/vnd.rhiza.workspace+zip');
        expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          const exited = once(child, 'exit');
          child.kill('SIGTERM');
          await exited;
        }
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 90_000);
