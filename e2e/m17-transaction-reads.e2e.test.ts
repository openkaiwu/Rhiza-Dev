// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
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
    const internal = store as unknown as { persist(database: SqlQueryable, next: WorkspaceData, previous?: WorkspaceData, options?: WorkspaceUpdateOptions): Promise<void> };
    const persist = internal.persist.bind(internal);
    const corrupt = vi.spyOn(internal,'persist').mockImplementationOnce(async (...args) => {
      await persist(...args);
      await args[0].query("UPDATE rhiza_nodes SET content_ref=jsonb_set(content_ref,'{reference,digest}',to_jsonb(repeat('b',64))) WHERE project_id=$1 AND id=$2", [workspace.projectId,workspace.activeNodeId]);
    });
    try { await expect(command()).rejects.toThrow('CONTENT_DIGEST_MISMATCH'); } finally { corrupt.mockRestore(); }
    expect(semanticChecksum(await store.read())).toBe(before);
    await command();
  } finally { vi.restoreAllMocks(); await store.close(); await rm(root, { recursive: true, force: true }); }
});
