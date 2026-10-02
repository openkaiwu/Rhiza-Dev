// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createSeedWorkspace } from '../server/seed';
import { SealedNodeContent } from '../server/infrastructure/sealed-node-content';
import type { SealedJournalContent } from '../server/infrastructure/sealed-journal-content';
import type { SealedReceiptContent } from '../server/infrastructure/sealed-receipt-content';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { NodeFilesystemBlobStore } from '../server/infrastructure/node-host-runtime';
import { semanticChecksum } from '../server/infrastructure/workspace-semantic-checksum';
import type { WorkspaceData } from '../server/domain';
import type { SqlQueryable } from '../server/postgres-store';
import type { WorkspaceUpdateOptions } from '../server/store';

it('M17 transaction reads decrypt unchanged nodes once and still reject corrupted shadow references without a half-commit', async () => {
  const root = await mkdtemp(join(tmpdir(),'rhiza-m17-transaction-'));
  const store = await openEmbeddedWorkspaceStore(join(root,'db'));
  try {
    const workspace = await store.read(); await store.backfillJournal();
    const disk = vi.spyOn(NodeFilesystemBlobStore.prototype,'readStream');
    const command = () => store.executeCommand({ context: { commandId: randomUUID(), commandType: 'RenameConversation', actor: { actorType: 'system', actorId: 'm17-fixture' }, scope: { scopeType: 'workspace', scopeId: workspace.projectId }, occurredAt: new Date().toISOString() },
      apply: async current => ({ next: { ...current, discussionNodes: current.discussionNodes.map(node => node.id === current.activeNodeId ? { ...node, title: `Fixture ${randomUUID()}` } : node) }, value: null }),
      events: () => [{ eventType: 'conversation.renamed', aggregateType: 'conversation', aggregateId: workspace.activeNodeId, payload: {} }] });
    await command();
    const nodeReads = () => disk.mock.contexts.filter(context => (context as unknown as { root: string }).root === join(`${join(root,'db')}.content`,'nodes')).length;
    expect(nodeReads()).toBe(workspace.discussionNodes.length + 1);
    const beforeReads = nodeReads(); await command(); expect(nodeReads() - beforeReads).toBe(workspace.discussionNodes.length + 1);
    disk.mockRestore();
    const before = semanticChecksum(await store.read());
    const internal = store as unknown as { journalContent: SealedJournalContent; receiptContent: SealedReceiptContent; persist(database: SqlQueryable, next: WorkspaceData, previous?: WorkspaceData, options?: WorkspaceUpdateOptions): Promise<void> };
    const persist = internal.persist.bind(internal);
    const corrupt = vi.spyOn(internal,'persist').mockImplementationOnce(async (...args) => {
      await persist(...args);
      await args[0].query("UPDATE rhiza_nodes SET content_ref=jsonb_set(content_ref,'{reference,digest}',to_jsonb(repeat('b',64))) WHERE project_id=$1 AND id=$2", [workspace.projectId,workspace.activeNodeId]);
    });
    const journalSeal = vi.spyOn(internal.journalContent, 'seal');
    const receiptSeal = vi.spyOn(internal.receiptContent, 'seal');
    try {
      await expect(command()).rejects.toThrow('CONTENT_DIGEST_MISMATCH');
      expect(journalSeal).not.toHaveBeenCalled();
      expect(receiptSeal).not.toHaveBeenCalled();
    } finally { corrupt.mockRestore(); journalSeal.mockRestore(); receiptSeal.mockRestore(); }
    expect(semanticChecksum(await store.read())).toBe(before);
    await command();
  } finally { vi.restoreAllMocks(); await store.close(); await rm(root, { recursive: true, force: true }); }
});

it('M17 node reads overlap within a bounded batch and preserve SQL ordering', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m17-bounded-reads-'));
  const store = await openEmbeddedWorkspaceStore(join(root, 'db'));
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let reading: Promise<WorkspaceData> | undefined;
  try {
    const seed = createSeedWorkspace();
    await store.initialize({ ...seed, discussionNodes: [...seed.discussionNodes, ...Array.from({ length: 18 }, (_, index) => ({
      ...seed.discussionNodes[0], id: randomUUID(), title: `Ordered fixture ${index}`, sourceNodeId: undefined, sourceMessageId: undefined,
    }))] });
    const expected = await store.read();
    const internal = store as unknown as { nodeContent: SealedNodeContent };
    const original = internal.nodeContent.read.bind(internal.nodeContent);
    let active = 0; let peak = 0;
    const decode = vi.spyOn(internal.nodeContent, 'read').mockImplementation(async (...args) => {
      active++; peak = Math.max(peak, active);
      try { await gate; return await original(...args); } finally { active--; }
    });
    reading = store.read();
    try { await vi.waitFor(() => expect(peak).toBeGreaterThan(1), { timeout: 1000, interval: 5 }); }
    finally { release(); }
    expect((await reading).discussionNodes).toEqual(expected.discussionNodes);
    expect(peak).toBeLessThanOrEqual(8);
    expect(active).toBe(0);
    decode.mockRestore();
  } finally { release(); await reading?.catch(() => undefined); vi.restoreAllMocks(); await store.close(); await rm(root, { recursive: true, force: true }); }
});

it('M17 failed node reads wait for their batch before releasing the transaction and launch no later batch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m17-failed-reads-'));
  const store = await openEmbeddedWorkspaceStore(join(root, 'db'));
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let outcome: Promise<unknown> | undefined;
  try {
    const seed = createSeedWorkspace();
    await store.initialize({ ...seed, discussionNodes: [...seed.discussionNodes, ...Array.from({ length: 18 }, () => ({
      ...seed.discussionNodes[0], id: randomUUID(), sourceNodeId: undefined, sourceMessageId: undefined,
    }))] });
    const internal = store as unknown as { nodeContent: SealedNodeContent };
    const original = internal.nodeContent.read.bind(internal.nodeContent);
    let started = 0; let active = 0; let failureReached = false; let settled = false;
    vi.spyOn(internal.nodeContent, 'read').mockImplementation(async (...args) => {
      const index = started++; active++;
      try {
        if (index === 1) { failureReached = true; throw new Error('injected node decode failure'); }
        await gate; return await original(...args);
      } finally { active--; }
    });
    outcome = store.read().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
    try {
      await vi.waitFor(() => expect(failureReached).toBe(true), { timeout: 1000, interval: 5 });
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(settled).toBe(false);
      expect(active).toBeGreaterThan(0);
    } finally { release(); }
    expect(await outcome).toMatchObject({ message: 'injected node decode failure' });
    expect(active).toBe(0);
    expect(started).toBeLessThanOrEqual(8);
  } finally { release(); await outcome; vi.restoreAllMocks(); await store.close(); await rm(root, { recursive: true, force: true }); }
});

it('M17 node-read batches respect the byte budget and read oversized documents alone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m17-read-bytes-'));
  const store = await openEmbeddedWorkspaceStore(join(root, 'db'));
  try {
    const workspace = await store.read();
    const internal = store as unknown as { database: SqlQueryable; nodeContent: SealedNodeContent };
    const sizes = [5 * 1024 ** 2, 5 * 1024 ** 2, 9 * 1024 ** 2];
    for (const [index, bytes] of sizes.entries()) {
      const id = randomUUID();
      const reference = await internal.nodeContent.seal(workspace.projectId, id, { title: `Large ${index}`, summary: 'x'.repeat(bytes) });
      await internal.database.query("INSERT INTO rhiza_nodes(id,project_id,title,summary,status,kind,created_at,content_ref) VALUES ($1,$2,'[sealed]','','active','branch',$3,$4::jsonb)",
        [id, workspace.projectId, `2026-10-01T00:00:0${index}.000Z`, JSON.stringify(reference)]);
    }
    const original = internal.nodeContent.read.bind(internal.nodeContent);
    let activeBytes = 0; let active = 0;
    vi.spyOn(internal.nodeContent, 'read').mockImplementation(async (...args) => {
      const size = args[2].reference.size;
      activeBytes += size; active++;
      try {
        expect(activeBytes <= 8 * 1024 ** 2 || active === 1).toBe(true);
        await new Promise<void>(resolve => setImmediate(resolve));
        return await original(...args);
      } finally { activeBytes -= size; active--; }
    });
    const result = await store.read();
    expect(result.discussionNodes.filter(node => node.title.startsWith('Large ')).map(node => node.summary.length)).toEqual(sizes);
    expect(active).toBe(0);
  } finally { vi.restoreAllMocks(); await store.close(); await rm(root, { recursive: true, force: true }); }
});
