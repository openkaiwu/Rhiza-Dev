import { describe, expect, it, vi } from 'vitest';
import { createLegacyCommandEnvelope, createLegacyQueryEnvelope } from '../contracts/application';
import { createSeedWorkspace } from '../seed';
import { createRhizaApplication } from './create-application';
import { WorkspaceDirectory } from '../identity/workspace-directory';
import { DEFAULT_WORKSPACE_ID, LOCAL_USER_ID } from '../identity/workspace-scope';

function fixture(options: { indexedPlanning?: boolean; failMutation?: boolean; committedRun?: import('../contracts/application').CreateConversationRunResult; ensureWorkspaceInitialized?: (workspaceId: string, name: string) => Promise<import('../domain').WorkspaceData>; blobPut?: (bytes: Uint8Array) => Promise<{ digestAlgorithm: 'sha256'; digest: string; blobRef: string; size: number }>; blobRead?: (blobRef: string, digest: string) => Promise<Uint8Array>; workspaceDirectory?: WorkspaceDirectory; defaultWorkspaceId?: string; initialWorkspace?: import('../domain').WorkspaceData; getRun?: () => Promise<import('../execution-runtime/run').ExecutionRun | undefined> } = {}) {
  let workspace = options.initialWorkspace ?? createSeedWorkspace();
  let sequence = 0;
  const commits: string[] = [];
  const runtimeCalls: string[] = [];
  const providerSnapshot = { filePolicy: { maxFileSizeBytes: 1_000_000, supportedMimeTypes: [], disabled: false, maxFiles: 1, maxTotalSizeBytes: 1_000_000, fileTokenLimit: 1 }, providers: [], models: [], activeModelId: null, modelSpecs: [] };
  const application = createRhizaApplication({
    unitOfWork: {
      read: async reader => { if (options.indexedPlanning) throw new Error('aggregate read forbidden'); return reader(workspace); },
      readConversationPreparation: async attachmentIds => ({ projectId: workspace.projectId, activeNodeId: workspace.activeNodeId, node: workspace.discussionNodes.find(node => node.id === workspace.activeNodeId), mode: workspace.mode, contextItems: workspace.contextItems, messages: workspace.messages.filter(message => message.nodeId === workspace.activeNodeId), attachments: workspace.attachments.filter(item => attachmentIds.includes(item.id)) }),
      execute: async mutation => { commits.push(mutation.policy.kind); if (options.failMutation) throw new Error('workspace write failed'); const result = await mutation.apply(workspace); workspace = result.next; return { workspace, value: result.value }; },
      readCommittedResult: async <T,>() => options.committedRun ? { found: true as const, value: options.committedRun as unknown as T } : { found: false as const },
      getRun: options.getRun,
      ensureWorkspaceInitialized: options.ensureWorkspaceInitialized,
    },
    runtime: {
      kind: 'provider-adapter',
      listModels: async () => [{ id: 'model-1', model: 'gpt-test', provider: 'test', displayName: 'Test', active: true }],
      async *generate() { runtimeCalls.push('generate'); yield { type: 'RUN_START', requestId: 'request', manifestId: 'manifest', model: 'gpt-test', provider: 'test' } as const; yield { type: 'RUN_END', requestId: 'request', text: 'answer', model: 'gpt-test', provider: 'test' } as const; },
    },
    providers: {
      snapshot: async () => providerSnapshot,
      activeStatus: async () => ({ configured: true, name: 'test', model: 'gpt-test', baseUrl: '' }),
      saveProvider: async () => providerSnapshot, discoverModels: async () => providerSnapshot, updateModel: async () => providerSnapshot, selectModel: async () => providerSnapshot,
    },
    host: {
      describe: () => ({ host: 'headless', fileAccess: 'available', pathNormalization: 'available', blobStorage: 'available', credentialAccess: 'unavailable', spawn: 'unavailable', desktop: 'unavailable' }),
      normalizePath: path => path,
      blobs: {
        put: options.blobPut ?? (async bytes => ({ digestAlgorithm: 'sha256', digest: 'a'.repeat(64), blobRef: `sha256/aa/${'a'.repeat(64)}`, size: bytes.length })),
        read: options.blobRead ?? (async () => new Uint8Array()),
        collectOrphans: async () => ({ deleted: [], retained: [] }),
      },
      readCredential: async () => ({ state: 'unavailable', reason: 'test' }),
    },
    textExtraction: { extractText: async (_mime, bytes) => new TextDecoder().decode(bytes) },
    indexedPlanner: options.indexedPlanning ? { plan: async input => ({ items: input.selection.filter(item => item.status === 'active'), diagnostics: { candidateCount: 1, selectedCount: 1, elapsedMs: 0, fallback: false, budget: input.budget, usedTokens: 1 } }) } : undefined,
    planner: {
      plan: current => ({ items: current.contextItems.filter(item => item.status === 'active'), diagnostics: { candidateCount: 1, selectedCount: 1, elapsedMs: 0, fallback: false, budget: 32_000, usedTokens: 1 } }),
      sourceItem: (_current, _type, sourceId) => ({ id: `context-${sourceId}`, title: sourceId, detail: sourceId, role: 'Reference', status: 'active', tokens: 1 }),
      processAttachment: () => ({ chunks: [], summary: 'summary' }),
    },
    id: () => `id-${++sequence}`,
    now: () => '2026-08-23T00:00:00.000Z',
    workspaceDirectory: options.workspaceDirectory,
    defaultWorkspaceId: options.defaultWorkspaceId,
  });
  return { application, commits, runtimeCalls, workspace: () => workspace };
}

describe('Rhiza Application', () => {
  it('reports a purged Replay source as missing content without dispatching', async () => {
    const { application, runtimeCalls } = fixture({ getRun: async () => {
      throw Object.assign(new Error('ExecutionRun content was purged'), { code: 'RUN_PURGED', status: 410 });
    } });
    await expect(application.execute(createLegacyCommandEnvelope('replay-purged', 'ReplayExecutionRun',
      { runId: 'purged-run', policy: 'exact' }))).rejects.toMatchObject({ details: { code: 'REPLAY_MISSING_RESOURCE', status: 409 } });
    expect(runtimeCalls).toEqual([]);
  });

  it('moves an attached ResourceVersion to a tombstone with the Purge audit fact', async () => {
    const seeded = createSeedWorkspace();
    const createdAt = '2026-08-22T00:00:00.000Z';
    const digest = 'a'.repeat(64);
    const initialWorkspace = { ...seeded,
      discussionNodes: [...seeded.discussionNodes, { id: 'private-node', title: 'private', summary: '', status: 'archived' as const,
        kind: 'branch' as const, sourceNodeId: seeded.activeNodeId, x: 0, y: 0, createdAt, updatedAt: createdAt }],
      messages: [...seeded.messages, { id: 'private-message', nodeId: 'private-node', kind: 'user' as const,
        text: 'private', attachmentIds: ['private-attachment'], createdAt }],
      resources: [...seeded.resources, { id: 'private-resource', workspaceId: seeded.projectId, kind: 'attachment' as const, logicalName: 'private.txt', createdAt }],
      resourceVersions: [...seeded.resourceVersions, { id: 'private-version', resourceId: 'private-resource', version: 1,
        digestAlgorithm: 'sha256' as const, digest, canonicalization: 'raw-v1' as const, mediaType: 'text/plain', size: 7,
        blobRef: `sealed-v1/${seeded.projectId}/private-version/${digest}/${digest}/7`, createdAt }],
      attachments: [...seeded.attachments, { id: 'private-attachment', name: 'private.txt', mimeType: 'text/plain', size: 7,
        kind: 'file' as const, resourceId: 'private-resource', resourceVersionId: 'private-version', digest, createdAt }],
      fileChunks: [...seeded.fileChunks, { id: 'private-chunk', attachmentId: 'private-attachment', ordinal: 0,
        text: 'private', startOffset: 0, endOffset: 7, tokens: 1, terms: ['private'], embedding: [], resourceVersionId: 'private-version' }],
      contextItems: [...seeded.contextItems, { id: 'private-context', title: 'private', detail: 'private bytes',
        role: 'Reference' as const, status: 'active' as const, tokens: 2, sourceType: 'chunk' as const,
        sourceId: 'private-chunk' }],
      manifests: [...seeded.manifests, { id: 'private-manifest', projectId: seeded.projectId, nodeId: 'private-node',
        requestId: 'private-request', createdAt, mode: 'Assisted' as const, provider: 'test', model: 'test',
        runtime: 'provider-adapter' as const, contextItemIds: [], excludedItemIds: [], contextItems: [{
          sourceType: 'file' as const, sourceId: 'private-attachment', title: 'private source', detail: 'private frozen detail',
          role: 'Reference' as const, selectionMode: 'CURRENT' as const, pinned: false, reason: '', tokenCount: 2,
          contentVersion: 1, resourceId: 'private-resource', resourceVersionId: 'private-version', digest,
        }], estimatedTokens: 2, generation: { temperature: 0.4, topP: 1, maxTokens: 100 },
        operation: 'send' as const, attachmentIds: ['private-attachment'] }],
    };
    const { application, workspace, commits } = fixture({ initialWorkspace });
    const result = await application.execute(createLegacyCommandEnvelope('purge-resource', 'PurgeObject',
      { nodeId: 'private-node', confirmation: 'PURGE private-node', reason: 'remove' }));
    expect(commits).toContain('purge');
    expect(result.purgeReceipt.createdAt).toBe('2026-08-23T00:00:00.000Z');
    expect(workspace().resourceVersions.find(version => version.id === 'private-version')).toMatchObject({ blobRef: 'purged-v1', purgedAt: result.purgeReceipt.createdAt });
    expect(workspace().resources.find(resource => resource.id === 'private-resource')?.logicalName).toBe('[purged]');
    expect(workspace().attachments).toEqual([]);
    expect(workspace().fileChunks).toEqual([]);
    expect(workspace().contextItems.find(item => item.id === 'private-context')).toBeUndefined();
    expect(workspace().manifests.find(item => item.id === 'private-manifest')).toBeUndefined();
  });
  it.each([false, undefined])('denies Purge before mutation when owner capability returns %s', async owner => {
    const record = { workspaceId: '00000000-0000-4000-8000-000000000001', name: 'Shared', status: 'active' as const, createdBy: LOCAL_USER_ID, revision: 1 };
    const directory = new WorkspaceDirectory({
      isOwner: owner === undefined ? undefined : async () => owner,
      listWorkspaces: async () => [record], createWorkspace: async () => ({ record, created: false }),
      updateWorkspace: async () => record, ensureWorkspace: async () => record,
    });
    const { application, commits } = fixture({ workspaceDirectory: directory });
    await expect(application.execute(createLegacyCommandEnvelope('purge-member', 'PurgeObject', { nodeId: 'node', confirmation: 'PURGE node', reason: 'test' })))
      .rejects.toMatchObject({ details: { code: 'WORKSPACE_OWNER_REQUIRED', status: 403 } });
    expect(commits).toEqual([]);
  });
  it('executes a conversation run with readiness, runtime observation, and one atomic commit', async () => {
    const { application, commits, workspace } = fixture(); const events: string[] = []; let ready = false;
    const result = await application.execute(createLegacyCommandEnvelope('command-1', 'CreateConversationRun', { prompt: 'hello', operation: 'send', attachmentIds: [], generation: { temperature: 0.4, topP: 1, maxTokens: 50 } }), { onReady: () => { ready = true; }, onRuntimeEvent: event => { events.push(event.type); } });
    expect(ready).toBe(true); expect(events).toEqual(['RUN_START', 'RUN_END']); expect(commits).toEqual(['normal']);
    expect(result.userMessage.versionGroupId).toBe(result.userMessage.id); expect(result.assistantMessage.replyToMessageId).toBe(result.userMessage.id);
    expect(workspace().messages).toHaveLength(4); expect(workspace().manifests).toHaveLength(1);
  });

  it('prepares indexed send and regenerate without reading the Workspace aggregate', async () => {
    const { application } = fixture({ indexedPlanning: true });
    const payload = { prompt: 'hello', operation: 'send' as const, attachmentIds: [], generation: { temperature: 0.4, topP: 1, maxTokens: 50 } };
    const first = await application.execute(createLegacyCommandEnvelope('indexed-send', 'CreateConversationRun', payload));
    const regenerated = await application.execute(createLegacyCommandEnvelope('indexed-regenerate', 'CreateConversationRun', { ...payload, operation: 'regenerate', sourceMessageId: first.assistantMessage.id }));
    expect(regenerated.userMessage.text).toBe('hello');
    expect(regenerated.userMessage.version).toBe(2);
    expect(regenerated.userMessage.versionGroupId).toBe(first.userMessage.versionGroupId);
  });

  it('returns a committed run receipt before invoking the external Runtime again', async () => {
    const existing = {
      userMessage: { id: 'prior-user', nodeId: 'information-architecture', kind: 'user' as const, text: 'prior', createdAt: '2026-08-23T00:00:00.000Z' },
      assistantMessage: { id: 'prior-assistant', nodeId: 'information-architecture', kind: 'assistant' as const, text: 'prior answer', createdAt: '2026-08-23T00:00:00.000Z' },
      manifest: { id: 'prior-manifest' } as import('../domain').ContextManifest,
    };
    const { application, runtimeCalls, commits } = fixture({ committedRun: existing });
    await expect(application.execute(createLegacyCommandEnvelope('same-run', 'CreateConversationRun', { prompt: 'hello', operation: 'send', attachmentIds: [], generation: { temperature: 0.4, topP: 1, maxTokens: 50 } }))).resolves.toBe(existing);
    expect(runtimeCalls).toEqual([]);
    expect(commits).toEqual([]);
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

  it('bootstraps only the configured local default before authorization', async () => {
    const defaultWorkspaceId = '00000000-0000-4000-8000-000000000099';
    const records = new Map<string, import('../contracts/application').WorkspaceRecord>();
    const initialized: string[] = [];
    const directory = new WorkspaceDirectory({
      listWorkspaces: async userId => [...records.values()].filter(record => record.createdBy === userId),
      createWorkspace: async record => ({ record, created: true }),
      updateWorkspace: async () => undefined,
      ensureWorkspace: async record => { records.set(record.workspaceId, record); return record; },
    });
    const { application } = fixture({ defaultWorkspaceId, workspaceDirectory: directory, ensureWorkspaceInitialized: async (workspaceId, name) => {
      initialized.push(`${workspaceId}:${name}`); return { ...createSeedWorkspace(), projectId: workspaceId, projectTitle: name };
    } });
    await expect(application.query({ queryId: 'default-bootstrap', queryType: 'GetWorkspace', payload: {}, schemaVersion: '1.0.0', workspaceId: defaultWorkspaceId, actor: { actorType: 'human', actorId: LOCAL_USER_ID }, scope: { scopeType: 'workspace', scopeId: defaultWorkspaceId } })).resolves.toMatchObject({ discussionNodes: [expect.any(Object)] });
    expect(records.get(defaultWorkspaceId)).toMatchObject({ createdBy: LOCAL_USER_ID });
    expect(initialized).toEqual([`${defaultWorkspaceId}:Rhiza 产品研究`]);
    const guessedId = '00000000-0000-4000-8000-000000000098';
    await expect(application.query({ queryId: 'guessed-scope', queryType: 'GetWorkspace', payload: {}, schemaVersion: '1.0.0', workspaceId: guessedId, actor: { actorType: 'human', actorId: LOCAL_USER_ID }, scope: { scopeType: 'workspace', scopeId: guessedId } })).rejects.toMatchObject({ details: { code: 'WORKSPACE_ACCESS_DENIED' } });
    expect(records.has(guessedId)).toBe(false);
  });

  it('rounds graph positions, reactivates a stale branch source, and trims branch drafts', async () => {
    const { application, workspace } = fixture();
    await application.execute(createLegacyCommandEnvelope('command-5', 'UpdateGraphLayout', { positions: [{ nodeId: 'information-architecture', x: 120.6, y: 80.4 }] }));
    await application.execute(createLegacyCommandEnvelope('command-6', 'ChangeNodeStatus', { nodeId: 'information-architecture', status: 'stale' }));
    await application.execute(createLegacyCommandEnvelope('command-7', 'CreateBranch', { title: 'Trimmed branch', anchorText: '', messages: [{ kind: 'user', text: '  preserved draft  ' }] }));
    expect(workspace().discussionNodes.find(node => node.id === 'information-architecture')).toMatchObject({ status: 'active', x: 121, y: 80 });
    expect(workspace().messages.at(-1)).toMatchObject({ text: 'preserved draft' });
  });

  it('leaves a promoted blob for orphan GC when the workspace commit fails', async () => {
    let promoted = false;
    const { application } = fixture({
      failMutation: true,
      blobPut: async bytes => { promoted = true; return { digestAlgorithm: 'sha256', digest: 'a'.repeat(64), blobRef: `sha256/aa/${'a'.repeat(64)}`, size: bytes.length }; },
    });
    await expect(application.execute(createLegacyCommandEnvelope('command-8', 'RegisterLegacyAttachment', {
      name: 'brief.txt', mimeType: 'text/plain', bytes: new TextEncoder().encode('attachment'),
    }))).rejects.toMatchObject({ details: { code: 'INTERNAL_ERROR' } });
    expect(promoted).toBe(true);
  });

  it('creates immutable ResourceVersions and validates the current digest before a run', async () => {
    const reads: string[] = [];
    const put = vi.fn(async (bytes: Uint8Array) => ({ digestAlgorithm: 'sha256' as const, digest: 'a'.repeat(64), blobRef: `sha256/aa/${'a'.repeat(64)}`, size: bytes.length }));
    const { application, workspace } = fixture({ blobPut: put, blobRead: async (blobRef, digest) => { reads.push(`${blobRef}:${digest}`); return new Uint8Array(); } });
    const first = await application.execute(createLegacyCommandEnvelope('resource-1', 'RegisterResource', { name: 'brief.txt', mimeType: 'text/plain', bytes: new TextEncoder().encode('v1') }));
    const second = await application.execute(createLegacyCommandEnvelope('resource-2', 'CreateResourceVersion', { attachmentId: first.attachment.id, bytes: new TextEncoder().encode('v2') }));
    expect(second.attachment.id).toBe(first.attachment.id);
    expect(workspace().resources).toHaveLength(1);
    expect(workspace().resourceVersions.map(item => item.version)).toEqual([1, 2]);
    expect(put.mock.calls).toEqual(workspace().resourceVersions.map((version, index) => [new TextEncoder().encode(`v${index + 1}`), {
      workspaceId: DEFAULT_WORKSPACE_ID, contentId: version.id,
    }]));
    expect(workspace().materializations).toHaveLength(2);
    await application.execute(createLegacyCommandEnvelope('resource-run', 'CreateConversationRun', { prompt: 'use it', operation: 'send', attachmentIds: [first.attachment.id], generation: { temperature: 0.4, topP: 1, maxTokens: 50 } }));
    expect(reads).toEqual([`${second.attachment.blobRef}:${second.attachment.digest}`]);
  });

  it('does not silently fall back when a ResourceVersion digest check fails', async () => {
    const { application } = fixture({ blobRead: async () => { throw Object.assign(new Error('corrupt'), { code: 'BLOB_INTEGRITY_ERROR', status: 409 }); } });
    const created = await application.execute(createLegacyCommandEnvelope('corrupt-1', 'RegisterResource', { name: 'brief.txt', mimeType: 'text/plain', bytes: new TextEncoder().encode('v1') }));
    await expect(application.execute(createLegacyCommandEnvelope('corrupt-2', 'CreateConversationRun', { prompt: 'use it', operation: 'send', attachmentIds: [created.attachment.id], generation: { temperature: 0.4, topP: 1, maxTokens: 50 } }))).rejects.toMatchObject({ message: expect.stringContaining('未使用可能损坏的数据'), details: { code: 'BLOB_INTEGRITY_ERROR', status: 409 } });
  });
});

describe('M12–M13 product commands', () => {
  it('fails closed on unavailable conversation preferences and clears inheritance explicitly', async () => {
    const f = fixture(); const nodeId = f.workspace().activeNodeId;
    await f.application.execute(createLegacyCommandEnvelope('prefer', 'SetConversationModel', { nodeId, modelId: 'model-1' }));
    expect(f.workspace().discussionNodes.find(node => node.id === nodeId)?.preferredModelId).toBe('model-1');
    await expect(f.application.execute(createLegacyCommandEnvelope('invalid', 'SetConversationModel', { nodeId, modelId: 'missing' }))).rejects.toMatchObject({ details: { code: 'MODEL_NOT_FOUND' } });
    await f.application.execute(createLegacyCommandEnvelope('inherit', 'SetConversationModel', { nodeId, modelId: null }));
    expect(f.workspace().discussionNodes.find(node => node.id === nodeId)?.preferredModelId).toBeUndefined();
  });
  it('renames and archives a Segment while preserving its original message and anchor', async () => {
    const f = fixture(); const nodeId = f.workspace().activeNodeId;
    const message = f.workspace().messages.find(message => message.nodeId === nodeId)!;
    const text = message.text.slice(0, 3);
    const result = await f.application.execute(createLegacyCommandEnvelope('segment', 'CreateSegment', { nodeId, title: 'excerpt', messageIds: [message.id], range: { messageId: message.id, startOffset: 0, endOffset: 3, selectedText: text } }));
    expect(result.workspace.anchors.find(anchor => anchor.segmentId === result.segment.id)).toMatchObject({ messageId: message.id, selectedText: text });
    await f.application.execute(createLegacyCommandEnvelope('archive-segment', 'UpdateSegment', { segmentId: result.segment.id, title: 'renamed', status: 'archived' }));
    expect(f.workspace().segments.find(segment => segment.id === result.segment.id)).toMatchObject({ title: 'renamed', status: 'archived' });
    expect(f.workspace().messages.find(item => item.id === message.id)?.text).toBe(message.text);
    await expect(f.application.execute(createLegacyCommandEnvelope('wrong-range', 'CreateSegment', { nodeId, title: 'bad', messageIds: [message.id], range: { messageId: message.id, startOffset: 0, endOffset: 3, selectedText: 'wrong' } }))).rejects.toMatchObject({ details: { code: 'INVALID_SEGMENT_RANGE' } });
  });
});
