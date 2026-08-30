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

  it('allows Application to use the M03 identity policy layer only', async () => {
    const root = await fixture({
      'server/contracts/references.ts': 'export type ActorRef = { id: string };',
      'server/identity/workspace-scope.ts': "import type { ActorRef } from '../contracts/references'; export const scope = (_: ActorRef) => 'workspace';",
      'server/application/application.ts': "import { scope } from '../identity/workspace-scope'; export const application = () => scope({ id: 'local' });",
      'scripts/boundary-gates/boundary-exceptions.json': '{"exceptions":[]}',
    });
    await expect(collectM02BoundaryViolations(root)).resolves.toEqual([]);
  });

  it('treats the root Domain Journal contract as domain code', async () => {
    const root = await fixture({
      'server/domain.ts': 'export type Workspace = { id: string };',
      'server/domain-journal.ts': "import type { Workspace } from './domain'; export type Event = { workspace: Workspace };",
      'server/application/ports/journal.ts': "import type { Event } from '../../domain-journal'; export interface Journal { append(event: Event): void; }",
      'scripts/boundary-gates/boundary-exceptions.json': '{"exceptions":[]}',
    });
    await expect(collectM02BoundaryViolations(root)).resolves.toEqual([]);
  });

  it('keeps identity isolated from infrastructure adapters', async () => {
    const root = await fixture({
      'server/infrastructure/store.ts': 'export const store = {};',
      'server/identity/bad.ts': "import { store } from '../infrastructure/store'; void store;",
      'server/application/application.ts': "import '../identity/bad';",
      'scripts/boundary-gates/boundary-exceptions.json': '{"exceptions":[]}',
    });
    await expect(collectM02BoundaryViolations(root)).resolves.toContainEqual(expect.objectContaining({ file: 'server/identity/bad.ts', message: expect.stringContaining('identity may not import infrastructure') }));
  });

  it.each([
    ['forbidden domain import', 'server/domain/bad.ts', "import fs from 'node:fs';"],
    ['forbidden domain child process import', 'server/domain/bad.ts', "import { execFile } from 'node:child_process'; void execFile;"],
    ['forbidden application provider import', 'server/application/bad.ts', "import OpenAI from 'openai';"],
    ['forbidden application child process import', 'server/application/bad.ts', "import { execFile } from 'node:child_process'; void execFile;"],
    ['unlisted domain host import', 'server/domain/bad.ts', "import { Worker } from 'node:worker_threads'; void Worker;"],
    ['CommonJS domain host import', 'server/domain/bad.cts', "const { Worker } = require('node:worker_threads'); void Worker;"],
    ['forbidden application LibreChat import', 'server/application/bad.ts', "import { createClient } from '@librechat/api'; void createClient;"],
    ['forbidden application model SDK import', 'server/application/bad.ts', "import { GoogleGenerativeAI } from '@google/generative-ai'; void GoogleGenerativeAI;"],
    ['unlisted application model SDK import', 'server/application/bad.ts', "import { OpenAIClient } from '@azure/openai'; void OpenAIClient;"],
    ['application import of an undeclared root adapter', 'server/application/bad.ts', "import '../secret-vault';"],
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

  it('blocks an Express route hidden outside the HTTP partition', async () => {
    const root = await fixture({
      'server/rogue-route.ts': "import express from 'express'; const repository = { write() {} }; const router = express.Router(); router.post('/x', () => repository.write()); export { router };",
      'scripts/boundary-gates/boundary-exceptions.json': '{"exceptions":[]}',
    });
    const violations = await collectM02BoundaryViolations(root, true);
    expect(violations).toContainEqual(expect.objectContaining({ file: 'server/rogue-route.ts', message: expect.stringContaining('outside server/http') }));
  });

  it('blocks a CommonJS Express route hidden outside the HTTP partition', async () => {
    const root = await fixture({
      'server/rogue-route.cts': "const express = require('express'); const repository = { write() {} }; const router = express.Router(); router.post('/x', () => repository.write()); module.exports = router;",
      'scripts/boundary-gates/boundary-exceptions.json': '{"exceptions":[]}',
    });
    const violations = await collectM02BoundaryViolations(root, true);
    expect(violations).toContainEqual(expect.objectContaining({ file: 'server/rogue-route.cts', message: expect.stringContaining('outside server/http') }));
  });
});
