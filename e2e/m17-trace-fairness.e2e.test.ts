// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { RunTraceBuffer, type ExecutionRun } from '../server/execution-runtime/run';
import { semanticStateChecksum } from '../server/infrastructure/workspace-semantic-checksum';
import type { SqlQueryable } from '../server/postgres-store';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m17-trace-fairness-'));
  const store = await openEmbeddedWorkspaceStore(join(root, 'db'));
  const close = async () => { await store.close(); await rm(root, { recursive: true, force: true }); };
  try {
    const workspace = await store.read();
    await store.workspaceDirectory.ensureWorkspace({ workspaceId: workspace.projectId, name: 'Trace fairness', status: 'active', createdBy: '00000000-0000-4000-8000-000000000002', revision: 1 });
    const at = '2026-10-02T00:00:00.000Z';
    const input: ExecutionRun['input'] = {
      schemaVersion: '1.0.0', executor: { runtime: 'fixture', modelSpecRef: 'fixture', providerEndpointRef: 'fixture', model: 'fixture', provider: 'fixture' },
      request: { requestId: randomUUID(), manifestId: randomUUID(), projectId: workspace.projectId, nodeId: workspace.activeNodeId, modelId: 'fixture', prompt: 'Trace fixture', history: [], contextItems: [], mode: 'Assisted' },
    };
    const run: ExecutionRun = { id: input.request.requestId, workspaceId: workspace.projectId, nodeId: workspace.activeNodeId, commandId: randomUUID(), status: 'created', attempt: 1, input,
      inputHash: semanticStateChecksum(input as unknown as Record<string, unknown>), createdAt: at, telemetry: { traceCount: 0 } };
    await store.executeCommand({ context: { commandId: run.commandId, commandType: 'CreateConversationRun', actor: { actorType: 'system', actorId: 'm17-trace-fixture' }, scope: { scopeType: 'workspace', scopeId: workspace.projectId }, occurredAt: at },
      options: { run: { kind: 'create', run } }, apply: async current => ({ next: current, value: null }),
      events: () => [{ eventType: 'run.created', aggregateType: 'run', aggregateId: run.id, payload: {} }] });
    const database = (store as unknown as { database: SqlQueryable }).database;
    const trace = new RunTraceBuffer(batch => store.writeRunTraces(run.id, run.attempt, batch));
    return { store, database, workspace, run, trace, at, close };
  } catch (error) { await close(); throw error; }
}

it('M17 yields between durable trace batches so a probe and Command run before all 10k traces complete', async () => {
  const { store, database, workspace, run, trace, at, close } = await fixture();
  try {
    let floodComplete = false; let commandBeforeCompletion = false;
    const probe = new Promise<void>(resolve => setImmediate(resolve)).then(async () => {
      const { rows } = await database.query<{ count: number }>('SELECT count(*)::int count FROM execution_run_traces WHERE run_id=$1 AND attempt=$2', [run.id, run.attempt]);
      return rows[0].count;
    });
    const commandId = randomUUID();
    const command = {
      context: { commandId, commandType: 'RenameConversation', actor: { actorType: 'system' as const, actorId: 'm17-trace-fixture' }, scope: { scopeType: 'workspace' as const, scopeId: workspace.projectId }, occurredAt: at },
      apply: async (current: typeof workspace) => {
        commandBeforeCompletion = !floodComplete;
        return { next: { ...current, discussionNodes: current.discussionNodes.map(node => node.id === current.activeNodeId ? { ...node, title: 'Available during trace flood' } : node) }, value: { id: current.activeNodeId } };
      },
      events: () => [{ eventType: 'conversation.renamed' as const, aggregateType: 'conversation', aggregateId: workspace.activeNodeId, payload: {} }],
    };
    const primary = store.executeCommand(command);
    const flood = (async () => {
      for (let index = 0; index < 10000; index++) await trace.push('CONTENT_DELTA', at);
      await trace.flush(); floodComplete = true;
    })();
    const outcomes = await Promise.allSettled([probe, primary, flood]);
    for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
    const observed = await probe;
    expect(observed).toBeGreaterThan(0);
    expect(observed).toBeLessThan(10000);
    expect(commandBeforeCompletion).toBe(true);
    expect((await primary).workspace.discussionNodes.find(node => node.id === workspace.activeNodeId)?.title).toBe('Available during trace flood');
    expect(await store.executeCommand(command)).toMatchObject({ duplicate: true, value: { id: workspace.activeNodeId } });
    expect((await database.query('SELECT event_id FROM workspace_events WHERE workspace_id=$1 AND command_id=$2', [workspace.projectId, commandId])).rows).toHaveLength(1);
    const { rows } = await database.query<{ sequence: number }>('SELECT sequence FROM execution_run_traces WHERE run_id=$1 AND attempt=$2 ORDER BY sequence', [run.id, run.attempt]);
    expect(trace.count).toBe(10000);
    expect(rows.map(row => row.sequence)).toEqual(Array.from({ length: 10000 }, (_, index) => index + 1));
    expect(await store.auditRunTraceMetadata()).toEqual({ total: 10000, invalid: 0 });
  } finally { await close(); }
});

it('M17 trace storage failures propagate without partial batches and a manual flush retains all pending sequences', async () => {
  const { database, run, trace, at, close } = await fixture();
  try {
    await database.query("CREATE FUNCTION fail_m17_trace() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected trace storage failure' USING ERRCODE='53100'; END $$");
    await database.query('CREATE TRIGGER fail_m17_trace BEFORE INSERT ON execution_run_traces FOR EACH ROW EXECUTE FUNCTION fail_m17_trace()');
    for (let index = 0; index < 127; index++) await trace.push('CONTENT_DELTA', at);
    await expect(trace.push('CONTENT_DELTA', at)).rejects.toMatchObject({ code: '53100', message: 'injected trace storage failure' });
    expect((await database.query('SELECT sequence FROM execution_run_traces WHERE run_id=$1', [run.id])).rows).toHaveLength(0);
    await database.query('DROP TRIGGER fail_m17_trace ON execution_run_traces');
    await trace.flush();
    const { rows } = await database.query<{ sequence: number }>('SELECT sequence FROM execution_run_traces WHERE run_id=$1 ORDER BY sequence', [run.id]);
    expect(trace.count).toBe(128);
    expect(rows.map(row => row.sequence)).toEqual(Array.from({ length: 128 }, (_, index) => index + 1));
  } finally { await close(); }
});
