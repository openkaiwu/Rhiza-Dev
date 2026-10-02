// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { semanticChecksum } from '../server/infrastructure/workspace-semantic-checksum';
import type { SealedReceiptContent, SealedReceiptRef } from '../server/infrastructure/sealed-receipt-content';
import type { SealedJournalContent, SealedJournalRef } from '../server/infrastructure/sealed-journal-content';
import type { SqlQueryable } from '../server/postgres-store';

function latch() {
  let release = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

it.each(['journal', 'receipt', 'sql', 'none'] as const)('M17 overlapping publications settle and clean every staged key when %s fails', async failing => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m17-publication-'));
  const store = await openEmbeddedWorkspaceStore(join(root, 'db'));
  const failed = latch(); const survivor = latch();
  let outcome: Promise<{ value?: unknown; error?: unknown }> | undefined;
  try {
    const workspace = await store.read(); await store.backfillJournal();
    const before = semanticChecksum(workspace);
    const internal = store as unknown as { database: SqlQueryable; journalContent: SealedJournalContent; receiptContent: SealedReceiptContent };
    const journalSeal = internal.journalContent.seal.bind(internal.journalContent);
    const receiptSeal = internal.receiptContent.seal.bind(internal.receiptContent);
    let journalStarted = false; let receiptStarted = false; let settled = false; let failureReached = false;
    const journals: Array<{ workspaceId: string; eventId: string; reference: SealedJournalRef }> = [];
    let receipt: SealedReceiptRef | undefined;
    vi.spyOn(internal.journalContent, 'seal').mockImplementation(async (...args) => {
      journalStarted = true;
      if (failing === 'journal') { await failed.promise; failureReached = true; throw new Error('injected journal publication failure'); }
      const reference = await journalSeal(...args);
      journals.push({ workspaceId: args[0], eventId: args[1], reference });
      await survivor.promise;
      return reference;
    });
    vi.spyOn(internal.receiptContent, 'seal').mockImplementation(async (...args) => {
      receiptStarted = true;
      if (failing === 'receipt') { await failed.promise; failureReached = true; throw new Error('injected receipt publication failure'); }
      receipt = await receiptSeal(...args);
      await survivor.promise;
      return receipt;
    });
    if (failing === 'sql') {
      await internal.database.query("CREATE FUNCTION fail_m17_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected sql publication failure'; END $$");
      await internal.database.query('CREATE TRIGGER fail_m17_publication BEFORE INSERT ON workspace_events FOR EACH ROW EXECUTE FUNCTION fail_m17_publication()');
    }
    const commandId = randomUUID();
    const command = {
      context: { commandId, commandType: 'RenameConversation', actor: { actorType: 'system' as const, actorId: 'm17-publication' }, scope: { scopeType: 'workspace' as const, scopeId: workspace.projectId }, occurredAt: new Date().toISOString() },
      apply: async (current: typeof workspace) => ({ next: { ...current, discussionNodes: current.discussionNodes.map(node => node.id === current.activeNodeId ? { ...node, title: 'published title' } : node) }, value: { retained: true } }),
      events: () => [{ eventType: 'conversation.renamed' as const, aggregateType: 'conversation', aggregateId: workspace.activeNodeId, payload: {} }],
    };
    outcome = store.executeCommand(command).then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
    await vi.waitFor(() => expect(journalStarted && receiptStarted).toBe(true), { timeout: 1000, interval: 5 });
    await vi.waitFor(() => expect(failing === 'journal' ? receipt : journals[0]).toBeDefined(), { timeout: 1000, interval: 5 });
    if (failing === 'journal' || failing === 'receipt') {
      failed.release();
      await vi.waitFor(() => expect(failureReached).toBe(true), { timeout: 1000, interval: 5 });
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(settled).toBe(false);
    }
    survivor.release();
    const result = await outcome;
    vi.restoreAllMocks();
    if (failing === 'none') {
      expect(result.value).toMatchObject({ value: { retained: true }, duplicate: false });
      expect((await store.read()).discussionNodes.find(node => node.id === workspace.activeNodeId)?.title).toBe('published title');
      expect(await store.executeCommand(command)).toMatchObject({ value: { retained: true }, duplicate: true });
      expect((await internal.database.query('SELECT event_id FROM workspace_events WHERE workspace_id=$1 AND command_id=$2', [workspace.projectId, commandId])).rows).toHaveLength(1);
    } else {
      expect(result.error).toMatchObject({ message: `injected ${failing} publication failure` });
      expect(semanticChecksum(await store.read())).toBe(before);
      expect((await internal.database.query('SELECT event_id FROM workspace_events WHERE workspace_id=$1 AND command_id=$2', [workspace.projectId, commandId])).rows).toHaveLength(0);
      expect((await internal.database.query('SELECT command_id FROM command_receipts WHERE workspace_id=$1 AND command_id=$2', [workspace.projectId, commandId])).rows).toHaveLength(0);
      if (receipt) await expect(internal.receiptContent.read(workspace.projectId, commandId, receipt)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
      for (const item of journals) await expect(internal.journalContent.read(item.workspaceId, item.eventId, item.reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    }
  } finally { failed.release(); survivor.release(); await outcome; vi.restoreAllMocks(); await store.close(); await rm(root, { recursive: true, force: true }); }
});
