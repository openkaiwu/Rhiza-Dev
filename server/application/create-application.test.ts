import { describe, expect, it } from 'vitest';
import { createLegacyCommandEnvelope, createLegacyQueryEnvelope } from '../contracts/application';
import { createSeedWorkspace } from '../seed';
import { createRhizaApplication } from './create-application';

function fixture(options: { failMutation?: boolean; ensureWorkspaceInitialized?: (workspaceId: string, name: string) => Promise<import('../domain').WorkspaceData>; uploads?: { put(key: string, bytes: Uint8Array): Promise<void>; delete?(key: string): Promise<void> } } = {}) {
  let workspace = createSeedWorkspace();
  let sequence = 0;
  const commits: string[] = [];
  const providerSnapshot = { filePolicy: { maxFileSizeBytes: 1_000_000, supportedMimeTypes: [], disabled: false, maxFiles: 1, maxTotalSizeBytes: 1_000_000, fileTokenLimit: 1 }, providers: [], models: [], activeModelId: null, modelSpecs: [] };
  const application = createRhizaApplication({
    unitOfWork: {
      read: async reader => reader(workspace),
      execute: async mutation => { commits.push(mutation.policy.kind); if (options.failMutation) throw new Error('workspace write failed'); const result = await mutation.apply(workspace); workspace = result.next; return { workspace, value: result.value }; },
      ensureWorkspaceInitialized: options.ensureWorkspaceInitialized,
    },
    runtime: {
      kind: 'provider-adapter',
      listModels: async () => [{ id: 'model-1', model: 'gpt-test', provider: 'test', displayName: 'Test', active: true }],
      async *generate() { yield { type: 'RUN_START', requestId: 'request', manifestId: 'manifest', model: 'gpt-test', provider: 'test' } as const; yield { type: 'RUN_END', requestId: 'request', text: 'answer', model: 'gpt-test', provider: 'test' } as const; },
    },
    providers: {
      snapshot: async () => providerSnapshot,
      activeStatus: async () => ({ configured: true, name: 'test', model: 'gpt-test', baseUrl: '' }),
      saveProvider: async () => providerSnapshot, discoverModels: async () => providerSnapshot, updateModel: async () => providerSnapshot, selectModel: async () => providerSnapshot,
    },
    uploads: options.uploads ?? { put: async () => undefined },
    textExtraction: { extractText: async (_mime, bytes) => new TextDecoder().decode(bytes) },
    planner: {
      plan: current => ({ items: current.contextItems.filter(item => item.status === 'active'), diagnostics: { candidateCount: 1, selectedCount: 1, elapsedMs: 0, fallback: false, budget: 32_000, usedTokens: 1 } }),
      sourceItem: (_current, _type, sourceId) => ({ id: `context-${sourceId}`, title: sourceId, detail: sourceId, role: 'Reference', status: 'active', tokens: 1 }),
      processAttachment: () => ({ chunks: [], summary: 'summary' }),
    },
    id: () => `id-${++sequence}`,
    now: () => '2026-08-23T00:00:00.000Z',
  });
  return { application, commits, workspace: () => workspace };
}

describe('Rhiza Application', () => {
  it('executes a conversation run with readiness, runtime observation, and one atomic commit', async () => {
    const { application, commits, workspace } = fixture(); const events: string[] = []; let ready = false;
    const result = await application.execute(createLegacyCommandEnvelope('command-1', 'CreateConversationRun', { prompt: 'hello', operation: 'send', attachmentIds: [], generation: { temperature: 0.4, topP: 1, maxTokens: 50 } }), { onReady: () => { ready = true; }, onRuntimeEvent: event => { events.push(event.type); } });
    expect(ready).toBe(true); expect(events).toEqual(['RUN_START', 'RUN_END']); expect(commits).toEqual(['normal']);
    expect(result.userMessage.versionGroupId).toBe(result.userMessage.id); expect(result.assistantMessage.replyToMessageId).toBe(result.userMessage.id);
    expect(workspace().messages).toHaveLength(4); expect(workspace().manifests).toHaveLength(1);
  });

  it('uses commands for representative workspace changes and serves queries', async () => {
    const { application, commits, workspace } = fixture();
    await application.execute(createLegacyCommandEnvelope('command-2', 'ChangeContextMode', { mode: 'Strict' }));
    await application.execute(createLegacyCommandEnvelope('command-3', 'CreateGraphNode', { title: 'Branch', x: 120, y: 80 }));
    const loaded = await application.query(createLegacyQueryEnvelope('query-1', 'GetWorkspace', {}));
    expect(loaded.mode).toBe('Strict'); expect(loaded.discussionNodes).toHaveLength(2); expect(commits).toEqual(['normal', 'normal']); expect(workspace().mode).toBe('Strict');
  });

  it('converts legacy validation failures at the application boundary', async () => {
    const { application } = fixture();
    await expect(application.execute(createLegacyCommandEnvelope('command-4', 'ChangeContextMode', { mode: 'invalid' as never }))).rejects.toMatchObject({ details: { code: 'INVALID_MODE', status: 400, category: 'validation' } });
  });

  it('rejects write commands without a matching actor and workspace scope', async () => {
    const { application } = fixture();
    await expect(application.execute({ commandId: 'missing-scope', commandType: 'CreateGraphNode', payload: { title: 'nope' } } as never)).rejects.toMatchObject({ details: { code: 'MISSING_ACTOR_OR_SCOPE', status: 403 } });
  });

  it('retries aggregate initialization after directory creation without allocating another workspace', async () => {
    let attempts = 0;
    const { application } = fixture({ ensureWorkspaceInitialized: async (workspaceId, name) => {
      attempts += 1;
      if (attempts === 1) throw new Error('simulated initialization failure');
      return { ...createSeedWorkspace(), projectId: workspaceId, projectTitle: name };
    } });
    const command = createLegacyCommandEnvelope('create-retry', 'CreateWorkspace', { name: 'Retry', workspaceId: 'retry-workspace' });
    await expect(application.execute(command)).rejects.toMatchObject({ details: { code: 'INTERNAL_ERROR' } });
    await expect(application.execute(command)).resolves.toMatchObject({ workspaceId: 'retry-workspace', name: 'Retry' });
    expect(attempts).toBe(2);
  });

  it('rounds graph positions, reactivates a stale branch source, and trims branch drafts', async () => {
    const { application, workspace } = fixture();
    await application.execute(createLegacyCommandEnvelope('command-5', 'UpdateGraphLayout', { positions: [{ nodeId: 'information-architecture', x: 120.6, y: 80.4 }] }));
    await application.execute(createLegacyCommandEnvelope('command-6', 'ChangeNodeStatus', { nodeId: 'information-architecture', status: 'stale' }));
    await application.execute(createLegacyCommandEnvelope('command-7', 'CreateBranch', { title: 'Trimmed branch', anchorText: '', messages: [{ kind: 'user', text: '  preserved draft  ' }] }));
    expect(workspace().discussionNodes.find(node => node.id === 'information-architecture')).toMatchObject({ status: 'active', x: 121, y: 80 });
    expect(workspace().messages.at(-1)).toMatchObject({ text: 'preserved draft' });
  });

  it('removes an uploaded object when the workspace commit fails', async () => {
    const deleted: string[] = [];
    const { application } = fixture({
      failMutation: true,
      uploads: { put: async () => undefined, delete: async key => { deleted.push(key); } },
    });
    await expect(application.execute(createLegacyCommandEnvelope('command-8', 'RegisterLegacyAttachment', {
      name: 'brief.txt', mimeType: 'text/plain', bytes: new TextEncoder().encode('attachment'),
    }))).rejects.toMatchObject({ details: { code: 'INTERNAL_ERROR' } });
    expect(deleted).toEqual(['id-1']);
  });
});
