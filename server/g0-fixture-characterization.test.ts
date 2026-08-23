// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './app';
import type { AIRuntime } from './ai-runtime';
import type { WorkspaceData } from './domain';
import { ProviderService } from './provider-service';
import { ProviderStore } from './provider-store';
import { SecretVault } from './secret-vault';
import { WorkspaceStore } from './store';

const root = resolve(import.meta.dirname, '..');
const directories: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()))));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

type FixtureRegistry = { fixtures: Array<{ id: string; path: string }> };

async function registeredFixtures(): Promise<Map<string, unknown>> {
  const registry = JSON.parse(await readFile(join(root, 'docs/architecture-gates/fixture-registry.json'), 'utf8')) as FixtureRegistry;
  const expectedIds = ['g0-empty-workspace-v1', 'g0-branch-context-provider-v1', 'g0-error-cancel-recovery-v1'];
  expect(registry.fixtures.map(item => item.id)).toEqual(expect.arrayContaining(expectedIds));
  return new Map(await Promise.all(registry.fixtures
    .filter(item => expectedIds.includes(item.id))
    .map(async item => [item.id, JSON.parse(await readFile(join(root, 'docs/architecture-gates', item.path), 'utf8'))] as const)));
}

it('loads registered workspace and error-retry fixtures to characterize route and recovery semantics', async () => {
  const fixtures = await registeredFixtures();
  const emptyWorkspaceFixture = fixtures.get('g0-empty-workspace-v1') as { workspace: WorkspaceData };
  const workspaceFixture = fixtures.get('g0-branch-context-provider-v1') as { workspace: WorkspaceData };
  const scenarioFixture = fixtures.get('g0-error-cancel-recovery-v1') as { scenario: { workspaceFixtureId: string; operations: Array<{ operation: string; expected: string }> } };
  expect(emptyWorkspaceFixture.workspace.discussionNodes).toHaveLength(1);
  expect(emptyWorkspaceFixture.workspace.discussionNodes[0]?.kind).toBe('main');
  expect(scenarioFixture.scenario.workspaceFixtureId).toBe('g0-branch-context-provider-v1');
  const directory = await mkdtemp(join(tmpdir(), 'rhiza-g0-fixture-'));
  directories.push(directory);
  const workspacePath = join(directory, 'workspace.json');
  await writeFile(workspacePath, `${JSON.stringify(emptyWorkspaceFixture.workspace, null, 2)}\n`, 'utf8');
  const store = new WorkspaceStore(workspacePath);
  let attempts = 0;
  const runtime: AIRuntime = {
    kind: 'provider-adapter',
    listModels: async () => [{ id: 'fixture', provider: 'Fixture', model: 'fixture', displayName: 'Fixture', active: true }],
    async *generate(input) {
      attempts += 1;
      yield { type: 'RUN_START', requestId: input.requestId, manifestId: input.manifestId, model: 'fixture', provider: 'Fixture' } as const;
      if (attempts === 1) { yield { type: 'RUN_ERROR', requestId: input.requestId, code: 'UPSTREAM_TIMEOUT', message: 'fixture timeout', status: 504 } as const; return; }
      yield { type: 'RUN_END', requestId: input.requestId, text: 'fixture retry complete', model: 'fixture', provider: 'Fixture' } as const;
    },
  };
  const provider = new ProviderService(new ProviderStore(join(directory, 'providers.json')), new SecretVault(join(directory, '.key')), { baseUrl: 'https://fixture.invalid', apiKey: '', model: 'fixture', providerName: 'Fixture', chatPath: '/chat/completions', timeoutMs: 1000, temperature: 0.4, extraHeaders: {}, allowNoKey: true });
  const server = createServer(createApp(store, provider, false, runtime));
  await new Promise<void>((resolveListen, rejectListen) => server.listen(0, '127.0.0.1', resolveListen).once('error', rejectListen));
  servers.push(server);
  const empty = await request(server).get('/api/workspace').expect(200);
  expect(empty.body.workspace.projectId).toBe(emptyWorkspaceFixture.workspace.projectId);
  expect(empty.body.workspace.discussionNodes).toHaveLength(1);
  // Loading a second immutable fixture is test orchestration, not a Domain
  // mutation. Write the isolated temp snapshot directly so production history
  // guards remain exercised by every repository update.
  await writeFile(workspacePath, `${JSON.stringify(workspaceFixture.workspace, null, 2)}\n`, 'utf8');
  const before = await request(server).get('/api/workspace').expect(200);
  expect(before.body.workspace.activeNodeId).toBe('fixture-main');
  expect(before.body.workspace.discussionNodes).toHaveLength(2);
  await request(server).post('/api/chat').send({ message: 'fixture retry route' }).expect(504);
  const failed = await request(server).get('/api/workspace').expect(200);
  expect(failed.body.workspace.messages).toEqual(before.body.workspace.messages);
  await request(server).post('/api/chat').send({ message: 'fixture retry route', operation: 'retry' }).expect(201);
  const recovered = await request(server).get('/api/workspace').expect(200);
  expect(recovered.body.workspace.messages.slice(-2).map((message: { operation: string }) => message.operation)).toEqual(['retry', 'retry']);
  expect(scenarioFixture.scenario.operations.map(item => `${item.operation}:${item.expected}`)).toContain('retry:committed');
});
