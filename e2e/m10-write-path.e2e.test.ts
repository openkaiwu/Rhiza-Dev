// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { semanticChecksum } from '../server/infrastructure/workspace-semantic-checksum';

describe('M10 production write path', () => {
  it('rejects the legacy write entry without applying the mutator', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rhiza-m10-'));
    const store = await openEmbeddedWorkspaceStore(join(root, 'db'));
    try {
      const before = await store.read();
      await expect(store.update(current => ({ ...current, projectTitle: 'unsafe' }))).rejects.toMatchObject({ code: 'LEGACY_WRITE_DISABLED' });
      expect(semanticChecksum(await store.read())).toBe(semanticChecksum(before));
    } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
  });
  it('refuses an initializer with another Workspace’s entity IDs and preserves the original', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rhiza-m10-'));
    const store = await openEmbeddedWorkspaceStore(join(root, 'db'));
    try {
      const before = await store.read();
      const other = store.forWorkspace(randomUUID());
      await expect(other.initialize!({ ...before, projectTitle: 'stolen', discussionNodes: before.discussionNodes.map(node => ({ ...node, title: 'stolen' })) })).rejects.toThrow();
      expect(semanticChecksum(await store.read())).toBe(semanticChecksum(before));
    } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
  });
  it('rejects an audit addressed to another Workspace before its transaction commits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rhiza-m10-audit-'));
    const store = await openEmbeddedWorkspaceStore(join(root, 'db'));
    try {
      const before = await store.read();
      const otherId = randomUUID();
      await store.forWorkspace(otherId).read();
      const otherBefore = await store.forWorkspace(otherId).read();
      await expect(store.executeCommand({ context: {
        commandId: randomUUID(), commandType: 'Audit', actor: { actorType: 'system', actorId: 'test' },
        scope: { scopeType: 'workspace', scopeId: before.projectId }, occurredAt: new Date().toISOString(),
      }, apply: async current => ({ next: { ...current, auditEvents: [...current.auditEvents, {
        id: randomUUID(), projectId: otherId, action: 'foreign', entityType: 'node', entityId: current.activeNodeId,
        metadata: {}, createdAt: new Date().toISOString(),
      }] }, value: null }), events: () => [{ eventType: 'graph.node.status_changed', aggregateType: 'node', aggregateId: before.activeNodeId, payload: {} }] })).rejects.toMatchObject({ code: 'WORKSPACE_REFERENCE_MISMATCH' });
      expect((await store.read()).auditEvents).toEqual(before.auditEvents);
      expect((await store.forWorkspace(otherId).read()).auditEvents).toEqual(otherBefore.auditEvents);
    } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
  });
});
