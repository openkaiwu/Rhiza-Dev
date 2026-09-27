// @vitest-environment node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { expect, it, vi } from 'vitest';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';

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

it('drains Purge recovery batches and refuses service when revocation cannot finish', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rhiza-purge-startup-'));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const dataDirectory = join(directory, 'data');
    const initial = await openEmbeddedWorkspaceStore(dataDirectory);
    const workspace = await initial.read();
    await initial.close();
    const database = new PGlite(dataDirectory);
    try {
      await database.waitReady;
      await database.query(`INSERT INTO purge_checkpoints(purge_id,workspace_id,node_id)
        SELECT value::uuid,$2::uuid,$3::uuid FROM jsonb_array_elements_text($1::jsonb)`,
      [JSON.stringify(Array.from({ length: 101 }, () => randomUUID())), workspace.projectId, randomUUID()]);
    } finally { await database.close(); }
    const portServer = createServer();
    await new Promise<void>(done => portServer.listen(0, '127.0.0.1', done));
    const address = portServer.address();
    if (!address || typeof address === 'string') throw new Error('TEST_PORT_UNAVAILABLE');
    await new Promise<void>(done => portServer.close(() => done()));
    const start = () => spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: resolve(import.meta.dirname, '..'), stdio: 'ignore', env: { ...process.env, DATABASE_URL: '', API_PORT: String(address.port),
        RHIZA_EMBEDDED_DATA_DIR: dataDirectory, RHIZA_UPLOAD_DIR: join(directory, 'uploads'), SERVE_FRONTEND: 'false' },
    });
    child = start();
    await vi.waitFor(async () => expect((await fetch(`http://127.0.0.1:${address.port}/api/health`)).status).toBe(200),
      { timeout: 30_000, interval: 200 });
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
    const verified = new PGlite(dataDirectory);
    try {
      await verified.waitReady;
      const result = await verified.query<{ phase: string; count: number }>('SELECT phase,count(*)::int count FROM purge_checkpoints GROUP BY phase');
      expect(result.rows).toEqual([{ phase: 'revoked', count: 101 }]);
      const purgeId = randomUUID();
      await verified.query('INSERT INTO purge_checkpoints(purge_id,workspace_id,node_id) VALUES ($1,$2,$3)',
        [purgeId, workspace.projectId, randomUUID()]);
      await verified.query(`INSERT INTO purge_key_references(purge_id,ordinal,content_family,entity_id,content_ref)
        VALUES ($1,0,'node',$2,'{}'::jsonb)`, [purgeId, randomUUID()]);
    } finally { await verified.close(); }
    child = start();
    await vi.waitFor(() => expect(child!.exitCode).toBe(1), { timeout: 15_000, interval: 100 });
    await expect(fetch(`http://127.0.0.1:${address.port}/api/health`)).rejects.toThrow();
    const failed = new PGlite(dataDirectory);
    try {
      await failed.waitReady;
      const result = await failed.query<{ phase: string; last_error: string }>("SELECT phase,last_error FROM purge_checkpoints WHERE phase='pending'");
      expect(result.rows).toEqual([{ phase: 'pending', last_error: 'Error' }]);
    } finally { await failed.close(); }
  } finally {
    if (child?.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
}, 90_000);
