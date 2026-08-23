// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectM02BoundaryViolations } from './verify-m02-boundaries';

const roots: string[] = [];
async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m02-gate-')); roots.push(root);
  await Promise.all(Object.entries(files).map(async ([file, source]) => { await mkdir(join(root, file, '..'), { recursive: true }); await writeFile(join(root, file), source); }));
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('M02 architecture boundary gate', () => {
  it('accepts an HTTP facade and clean layer direction', async () => {
    const root = await fixture({
      'server/contracts/commands.ts': 'export type Command = { type: string };',
      'server/contracts/application.ts': 'export interface Application { execute(command: unknown): Promise<unknown>; }',
      'server/domain/version.ts': "import type { Command } from '../contracts/commands'; export const version = (_: Command) => 1;",
      'server/application/application.ts': "import type { Command } from '../contracts/commands'; export const application = { execute: async (_: Command) => undefined };",
      'server/http/app.ts': "import express from 'express'; import type { Application } from '../contracts/application'; export function create(application: Application) { const router = express.Router(); router.post('/x', async (_req, res) => { await application.execute({ type: 'x' }); res.sendStatus(204); }); return router; }",
      'scripts/boundary-gates/boundary-exceptions.json': '{"exceptions":[]}',
    });
    await expect(collectM02BoundaryViolations(root, true)).resolves.toEqual([]);
  });

  it.each([
    ['forbidden domain import', 'server/domain/bad.ts', "import fs from 'node:fs';"],
    ['forbidden domain child process import', 'server/domain/bad.ts', "import { execFile } from 'node:child_process'; void execFile;"],
    ['forbidden application provider import', 'server/application/bad.ts', "import OpenAI from 'openai';"],
    ['forbidden application child process import', 'server/application/bad.ts', "import { execFile } from 'node:child_process'; void execFile;"],
    ['forbidden application LibreChat import', 'server/application/bad.ts', "import { createClient } from '@librechat/api'; void createClient;"],
    ['forbidden application model SDK import', 'server/application/bad.ts', "import { GoogleGenerativeAI } from '@google/generative-ai'; void GoogleGenerativeAI;"],
    ['reverse legacy context planner dependency', 'server/context-runtime/legacy-planner.ts', "import '../application/application';"],
    ['direct HTTP store access', 'server/http/bad.ts', "const workspaceRepository = { read() {} }; workspaceRepository.read();"],
    ['aliased HTTP store access', 'server/http/bad.ts', "const workspaceStore = { write() {} }; const persistence = workspaceStore; persistence.write();"],
    ['destructured HTTP store access', 'server/http/bad.ts', "const workspaceStore = { write() {} }; const { write } = workspaceStore; write();"],
    ['mutating route without command', 'server/http/bad.ts', "const router = { post(_p: string, _fn: unknown) {} }; router.post('/x', () => undefined);"],
    ['token execute without injected Application', 'server/http/bad.ts', "const router = { post(_p: string, _fn: unknown) {} }; const execute = async () => undefined; router.post('/x', () => execute());"],
    ['reverse layer dependency', 'server/domain/bad.ts', "import '../application/application';"],
  ])('reports %s', async (_name, path, source) => {
    const root = await fixture({ [path]: source, 'server/application/application.ts': 'export {};', 'scripts/boundary-gates/boundary-exceptions.json': '{"exceptions":[]}' });
    await expect(collectM02BoundaryViolations(root)).resolves.not.toEqual([]);
  });

  it('accepts only a helper proven to call the injected Application facade', async () => {
    const root = await fixture({
      'server/contracts/application.ts': 'export interface Application { execute(command: unknown): Promise<unknown>; }',
      'server/http/app.ts': "import express from 'express'; import type { Application } from '../contracts/application'; export function create(application: Application) { const executeCommand = (command: unknown) => application.execute(command); const router = express.Router(); router.patch('/x', async () => executeCommand({ type: 'x' })); return router; }",
      'scripts/boundary-gates/boundary-exceptions.json': '{"exceptions":[]}',
    });
    await expect(collectM02BoundaryViolations(root, true)).resolves.toEqual([]);
  });

  it('blocks legacy routes and the M01 exception registry in strict mode', async () => {
    const root = await fixture({
      'server/app.ts': "import express from 'express'; const app = express(); app.post('/x', () => undefined);",
      'scripts/boundary-gates/boundary-exceptions.json': '{"exceptions":[{"id":"legacy"}]}',
    });
    const violations = await collectM02BoundaryViolations(root, true);
    expect(violations.map(item => item.message).join('\n')).toContain('legacy route logic remains');
    expect(violations.map(item => item.message).join('\n')).toContain('exception registry must be empty');
  });
});
