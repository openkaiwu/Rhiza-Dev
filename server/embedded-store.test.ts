import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { openEmbeddedWorkspaceStore } from './embedded-store';
import { createSeedWorkspace } from './seed';
import { PostgresWorkspaceStore, relationalizeWorkspace, type SqlQueryable } from './postgres-store';
import { semanticChecksum, semanticStateChecksum } from './infrastructure/workspace-semantic-checksum';
import type { ExecutionRun, ContextEnvelope } from './execution-runtime/run';
import { SealedMessageContent } from './infrastructure/sealed-message-content';
import { SealedReceiptContent } from './infrastructure/sealed-receipt-content';
import { SealedRunContent } from './infrastructure/sealed-run-content';
import { SealedJournalContent } from './infrastructure/sealed-journal-content';
import { SealedManifestContent } from './infrastructure/sealed-manifest-content';
import { SealedNodeContent } from './infrastructure/sealed-node-content';
import { SealedAnchorContent } from './infrastructure/sealed-anchor-content';
import { SealedSegmentContent } from './infrastructure/sealed-segment-content';
import { SealedEdgeContent } from './infrastructure/sealed-edge-content';
import { randomUUID } from 'node:crypto';

describe('embedded Workspace backend', () => {
  it('checks all content families before revoking any key and locks references before reading them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-reclaim-preflight-'));
    const receipts = SealedReceiptContent.atDirectory(join(directory, 'receipts'));
    const candidate = await receipts.seal('workspace', 'unpublished', { keep: true });
    const statements: string[] = [];
    const query = async (sql: string) => {
      statements.push(sql);
      return { rows: sql.includes("SELECT 'runs'")
        ? [{ family: 'messages', workspace_id: 'workspace', id: 'message', reference: { contentId: 'missing' } }]
        : [] };
    };
    const database = {
      query: async () => { throw new Error('query escaped transaction'); },
      transaction: async <T>(callback: (client: SqlQueryable) => Promise<T>) => callback({ query } as SqlQueryable),
    };
    const store = new PostgresWorkspaceStore(database, undefined, receipts, SealedRunContent.atDirectory(join(directory, 'runs')), SealedJournalContent.atDirectory(join(directory, 'journal')), SealedMessageContent.atDirectory(join(directory, 'messages')), SealedManifestContent.atDirectory(join(directory, 'manifests')), SealedNodeContent.atDirectory(join(directory, 'nodes')), SealedAnchorContent.atDirectory(join(directory, 'anchors')), SealedSegmentContent.atDirectory(join(directory, 'segments')), SealedEdgeContent.atDirectory(join(directory, 'edges')));
    try {
      await expect(store.reclaimHistoricalKeys()).rejects.toThrow('CONTENT_KEY_REFERENCES_UNHEALTHY');
      expect(await receipts.read('workspace', 'unpublished', candidate)).toEqual({ keep: true });
      expect(statements[0]).toBe("SET LOCAL lock_timeout = '5s'");
      expect(statements[1]).toContain('pg_advisory_xact_lock(');
      expect(statements[2]).toBe('LOCK TABLE command_receipts,execution_runs,workspace_events,rhiza_messages,rhiza_nodes,rhiza_context_manifests,rhiza_anchors,rhiza_segments,rhiza_edges IN SHARE MODE');
      expect(statements.slice(3).every(sql => sql.trim().startsWith('SELECT'))).toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('takes lifecycle locks before transaction work and audits on the locked connection', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-content-lock-'));
    const statements: string[] = [];
    const query = async (sql: string) => { statements.push(sql); return { rows: [] }; };
    const database = { query: async () => { throw new Error('query escaped transaction'); }, transaction: async <T>(callback: (client: SqlQueryable) => Promise<T>) => callback({ query }) };
    const store = new PostgresWorkspaceStore(database, undefined, SealedReceiptContent.atDirectory(join(directory, 'receipts')), SealedRunContent.atDirectory(join(directory, 'runs')), SealedJournalContent.atDirectory(join(directory, 'journal')), SealedMessageContent.atDirectory(join(directory, 'messages')), SealedManifestContent.atDirectory(join(directory, 'manifests')), SealedNodeContent.atDirectory(join(directory, 'nodes')), SealedAnchorContent.atDirectory(join(directory, 'anchors')), SealedSegmentContent.atDirectory(join(directory, 'segments')), SealedEdgeContent.atDirectory(join(directory, 'edges')));
    try {
      await store.readExisting();
      expect(statements[0]).toContain("pg_advisory_xact_lock_shared(hashtext('rhiza:content-lifecycle'))");
      statements.length = 0;
      await store.auditHistoricalKeys();
      expect(statements[0]).toBe("SET LOCAL lock_timeout = '5s'");
      expect(statements[1]).toContain("pg_advisory_xact_lock(hashtext('rhiza:content-lifecycle'))");
      expect(statements.slice(2).every(sql => sql.trim().startsWith('SELECT'))).toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('treats an empty configured Workspace ID as absent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-empty-workspace-id-'));
    const store = await openEmbeddedWorkspaceStore(join(directory, 'database'), '');
    try {
      await expect(store.read()).resolves.toMatchObject({ projectId: '00000000-0000-4000-8000-000000000001' });
    } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
  }, 30_000);

  it('rejects a non-UUID configured Workspace ID before issuing a query', async () => {
    const database = new PGlite();
    try {
      expect(() => new PostgresWorkspaceStore(database, 'not-a-uuid')).toThrow('RHIZA_PROJECT_ID must be a UUID when set');
    } finally { await database.close(); }
  });

  it('does not create an absent database or Workspace during reconciliation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-reconcile-'));
    const data = join(directory, 'database');
    try {
      await expect(openEmbeddedWorkspaceStore(data, undefined, 'verify')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(data)).rejects.toMatchObject({ code: 'ENOENT' });
      const store = await openEmbeddedWorkspaceStore(data);
      try {
        expect(await store.readExisting()).toBeUndefined();
        expect(await store.listWorkspaceIds()).toEqual([]);
      } finally { await store.close(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('auto-migrates, persists state, and reopens the same Journal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-pglite-'));
    const data = join(directory, 'database');
    try {
      const first = await openEmbeddedWorkspaceStore(data);
      let seeded = await first.read();
      const targetNode = { ...seeded.discussionNodes[0], id: randomUUID(), title: 'relation target' };
      const edge = { id: randomUUID(), source: seeded.discussionNodes[0].id, target: targetNode.id, relation: 'related-to' as const, label: 'private relationship', createdAt: new Date().toISOString() };
      seeded = await first.update(current => ({ ...current, discussionNodes: [...current.discussionNodes, targetNode], discussionEdges: [...current.discussionEdges, edge] }));
      const anchor = { id: randomUUID(), nodeId: seeded.messages[0].nodeId, messageId: seeded.messages[0].id, selectedText: 'persisted private quote', startOffset: 0, endOffset: 4, createdAt: new Date().toISOString() };
      await first.update(current => ({ ...current, anchors: [...current.anchors, anchor] }));
      await first.workspaceDirectory.createWorkspace({ workspaceId: seeded.projectId, name: 'Run persistence test', status: 'active', createdBy: '00000000-0000-4000-8000-000000000002', revision: 1 });
      const baseline = await first.backfillJournal();
      const commandId = randomUUID();
      const context = { commandId, commandType: 'TestReceipt', actor: { actorType: 'human' as const, actorId: '00000000-0000-4000-8000-000000000002' }, scope: { scopeType: 'workspace' as const, scopeId: seeded.projectId }, occurredAt: new Date().toISOString() };
      const input: ContextEnvelope = { schemaVersion: '1.0.0', request: { requestId: commandId, manifestId: 'manifest', projectId: seeded.projectId, nodeId: seeded.activeNodeId, modelId: 'model', prompt: 'private persisted input', history: [], contextItems: [], mode: 'Auto' }, executor: { runtime: 'test', modelSpecRef: 'model', providerEndpointRef: 'endpoint', model: 'model', provider: 'provider' } };
      const run: ExecutionRun = { id: commandId, commandId, workspaceId: seeded.projectId, nodeId: seeded.activeNodeId, status: 'created', attempt: 1, input, inputHash: semanticStateChecksum(input as unknown as Record<string, unknown>), createdAt: context.occurredAt, telemetry: { traceCount: 0 } };
      await first.executeCommand({ context, options: { run: { kind: 'create', run } }, apply: async current => ({ next: current, value: { text: 'encrypted after reopen' } }), events: () => [{ eventType: 'workspace.renamed', aggregateType: 'workspace', aggregateId: seeded.projectId, payload: {} }] });
      const persistedMessages = (await first.read()).messages;
      await first.close();

      const reopened = await openEmbeddedWorkspaceStore(data, undefined, 'verify');
      expect(await reopened.read()).toMatchObject({ projectId: seeded.projectId, activeNodeId: seeded.activeNodeId });
      expect(await reopened.backfillJournal()).toEqual({ checksum: baseline.checksum, created: false, eventCount: 2 });
      expect((await reopened.readCommandReceipt(commandId))?.result).toEqual({ text: 'encrypted after reopen' });
      expect(await reopened.getRun(run.id)).toEqual(run);
      expect((await reopened.read()).messages).toEqual(persistedMessages);
      expect((await reopened.readJournal()).find(event => event.sequence === 1)?.payload.snapshot).toBeTruthy();
      const audit = await reopened.auditHistoricalKeys();
      for (const records of Object.values(audit)) expect(records.every(record => record.referenced && record.state === 'active')).toBe(true);
      expect(audit.messages).toHaveLength(persistedMessages.length);
      expect(audit.runs).toHaveLength(1);
      expect(audit.nodes).toHaveLength(seeded.discussionNodes.length);
      expect(audit.anchors).toHaveLength(1);
      expect(audit.segments).toHaveLength(seeded.segments.length);
      expect(audit.edges).toHaveLength(seeded.discussionEdges.length);
      expect((await reopened.read()).discussionEdges).toEqual(seeded.discussionEdges);
      expect((await reopened.read()).segments).toEqual(seeded.segments);
      expect((await reopened.read()).anchors).toContainEqual(anchor);
      expect((await reopened.read()).discussionNodes).toEqual(seeded.discussionNodes);
      expect(audit.journal).toHaveLength(2);
      const content = SealedMessageContent.atDirectory(join(`${data}.content`, 'messages'));
      const candidate = await content.seal(seeded.projectId, 'uncommitted-message', { text: 'pending transaction' });
      const candidates = (await reopened.auditHistoricalKeys()).messages.filter(record => !record.referenced);
      expect(candidates).toEqual([expect.objectContaining({ state: 'active' })]);
      expect(await content.read(seeded.projectId, 'uncommitted-message', candidate)).toEqual({ text: 'pending transaction' });
      expect(await reopened.reclaimHistoricalKeys()).toBe(1);
      await expect(content.read(seeded.projectId, 'uncommitted-message', candidate)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
      expect(await reopened.reclaimHistoricalKeys()).toBe(0);
      expect((await reopened.read()).messages).toEqual(persistedMessages);
      expect(await reopened.getRun(run.id)).toEqual(run);
      expect((await reopened.readCommandReceipt(commandId))?.result).toEqual({ text: 'encrypted after reopen' });
      await reopened.close();
      const inspection = new PGlite(data);
      try {
        const edges = (await inspection.query('SELECT label,content_ref FROM rhiza_edges')).rows;
        expect(edges).toHaveLength(seeded.discussionEdges.length);
        for (const edge of edges) expect(edge).toEqual({ label: '', content_ref: expect.objectContaining({ format: 'rhiza.sealed-edge.v1' }) });
        const segments = (await inspection.query('SELECT title,content_ref FROM rhiza_segments')).rows;
        expect(segments).toHaveLength(seeded.segments.length);
        for (const segment of segments) expect(segment).toEqual({ title: '', content_ref: expect.objectContaining({ format: 'rhiza.sealed-segment.v1' }) });
        expect((await inspection.query('SELECT selected_text,content_ref FROM rhiza_anchors WHERE id=$1', [anchor.id])).rows[0])
          .toEqual({ selected_text: null, content_ref: expect.objectContaining({ format: 'rhiza.sealed-anchor.v1' }) });
        const nodes = (await inspection.query<{ title: string; summary: string; anchor_text: unknown; content_ref: unknown }>('SELECT title,summary,anchor_text,content_ref FROM rhiza_nodes')).rows;
        expect(nodes).toHaveLength(seeded.discussionNodes.length);
        for (const node of nodes) expect(node).toMatchObject({ title: '[sealed]', summary: '', anchor_text: null, content_ref: expect.objectContaining({ format: 'rhiza.sealed-node.v1' }) });
        const row = await inspection.query<{ result: unknown; result_content_ref: unknown }>('SELECT result,result_content_ref FROM command_receipts WHERE command_id=$1', [commandId]);
        expect(row.rows[0].result).toBeNull();
        expect(row.rows[0].result_content_ref).not.toBeNull();
        const stored = (await inspection.query<{ input_envelope: unknown; record: { input: unknown }; input_content_ref: unknown }>('SELECT input_envelope,record,input_content_ref FROM execution_runs WHERE run_id=$1', [run.id])).rows[0];
        expect(stored.input_envelope).toEqual({ sealed: true });
        expect(stored.record.input).toEqual({ sealed: true });
        expect(stored.input_content_ref).not.toBeNull();
        const events = (await inspection.query<{ payload: unknown; payload_content_ref: unknown }>('SELECT payload,payload_content_ref FROM workspace_events')).rows;
        expect(events).toHaveLength(2);
        expect(events.every(event => JSON.stringify(event.payload) === JSON.stringify({ sealed: true }) && event.payload_content_ref !== null)).toBe(true);
        const messages = (await inspection.query<{ body: string; reasoning: unknown; tool_calls: unknown; content_ref: unknown }>('SELECT body,reasoning,tool_calls,content_ref FROM rhiza_messages')).rows;
        expect(messages.length).toBeGreaterThan(0);
        expect(messages.every(message => message.body === '' && message.reasoning === null && message.tool_calls === null && message.content_ref !== null)).toBe(true);
      } finally { await inspection.close(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 30_000);

  it('imports a complete non-UUID JSON aggregate without dropping semantic content', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-json-import-'));
    const workspaceId = randomUUID();
    const store = await openEmbeddedWorkspaceStore(join(directory, 'database'), workspaceId);
    try {
      const source = createSeedWorkspace();
      const createdAt = '2026-08-30T00:00:00.000Z';
      source.discussionNodes.push({ id: 'legacy-branch', title: 'Legacy branch', summary: 'must survive', status: 'active', kind: 'branch', sourceNodeId: source.activeNodeId, x: 20, y: 30, createdAt, updatedAt: createdAt });
      source.messages.push({ id: 'legacy-message', nodeId: 'legacy-branch', kind: 'user', text: 'legacy content', createdAt });
      const expected = relationalizeWorkspace(source, workspaceId);
      await store.initialize(source);
      const recovered = await store.read();
      expect(semanticChecksum(recovered)).toBe(semanticChecksum(expected));
      expect(recovered.messages).toContainEqual(expect.objectContaining({ text: 'legacy content' }));
      expect(recovered.discussionNodes).toContainEqual(expect.objectContaining({ title: 'Legacy branch', summary: 'must survive' }));
    } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
  }, 30_000);
});
