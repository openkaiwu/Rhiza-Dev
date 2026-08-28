// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import type { ContextManifest } from '../server/domain';
import { PostgresWorkspaceStore } from '../server/postgres-store';
import { RepositoryWorkspaceUnitOfWork } from '../server/infrastructure/workspace-repository-unit-of-work';

async function migratedDatabase() {
  const database = new PGlite();
  for (const migration of ['0001_rhiza_core', '0002_chat_parity', '0003_domain_persistence', '0004_immutable_manifest_history']) {
    await database.exec(await readFile(resolve(`db/migrations/${migration}.up.sql`), 'utf8'));
  }
  await database.exec(await readFile(resolve('db/migrations/0005_identity_workspace_scope.up.sql'), 'utf8'));
  return database;
}

describe('PostgreSQL workspace persistence', () => {
  it('atomically accepts only one PostgreSQL directory revision update', async () => {
    const database = await migratedDatabase();
    try {
      const store = new PostgresWorkspaceStore(database);
      const port = store.workspaceDirectory!;
      const record = { workspaceId: randomUUID(), name: 'Original', status: 'active' as const, createdBy: '00000000-0000-4000-8000-000000000002', revision: 1 };
      await port.createWorkspace(record);
      const [first, second] = await Promise.all([
        port.updateWorkspace({ ...record, name: 'First', revision: 2 }, 1),
        port.updateWorkspace({ ...record, name: 'Second', revision: 2 }, 1),
      ]);
      expect([first, second].filter(Boolean)).toHaveLength(1);
      expect(await port.listWorkspaces(record.createdBy, true)).toEqual(expect.arrayContaining([expect.objectContaining({ workspaceId: record.workspaceId, revision: 2, name: expect.stringMatching(/First|Second/) })]));
    } finally { await database.close(); }
  });

  it('persists a scoped aggregate across reconstructed UoWs without changing default', async () => {
    const database = await migratedDatabase();
    try {
      const defaultId = randomUUID(); const scopedId = randomUUID();
      const unit = new RepositoryWorkspaceUnitOfWork(new PostgresWorkspaceStore(database, defaultId));
      await unit.read(item => item.projectId);
      await unit.createWorkspace(scopedId, 'Second workspace');
      await unit.withWorkspace!(scopedId, () => unit.execute({ policy: { kind: 'normal' }, apply: current => ({ next: { ...current, projectTitle: 'Scoped saved' }, value: undefined }) }));
      const restored = new RepositoryWorkspaceUnitOfWork(new PostgresWorkspaceStore(database, defaultId));
      await expect(restored.withWorkspace!(scopedId, () => restored.read(item => item.projectTitle))).resolves.toBe('Scoped saved');
      await expect(restored.read(item => item.projectTitle)).resolves.toBe('Rhiza 产品研究');
    } finally { await database.close(); }
  });
  it('transactionally restores Project, Node, Segment, Event and audit state', async () => {
    const database = await migratedDatabase();
    try {
      const projectId = randomUUID();
      const store = new PostgresWorkspaceStore(database, projectId);
      const seeded = await store.read();
      expect(seeded).toMatchObject({ projectId, projectTitle: 'Rhiza 产品研究', mode: 'Assisted' });
      expect(seeded.discussionNodes).toHaveLength(1);
      expect(seeded.segments).toHaveLength(1);
      expect(seeded.messages.map(event => event.text)).toHaveLength(2);

      const eventId = randomUUID();
      const branchId = randomUUID();
      const anchorId = randomUUID();
      const edgeId = randomUUID();
      const createdAt = new Date().toISOString();
      const updated = await store.update(current => ({
        ...current,
        mode: 'Strict',
        messages: [...current.messages, { id: eventId, nodeId: current.activeNodeId, segmentId: current.segments[0].id, kind: 'user', text: '持久化验证事件', createdAt }],
        discussionNodes: [...current.discussionNodes, { id: branchId, title: '精确锚点支线', summary: '验证 Anchor 恢复', status: 'active', kind: 'branch', sourceNodeId: current.activeNodeId, sourceMessageId: eventId, anchorText: '验证事件', x: 620, y: 280, createdAt, updatedAt: createdAt }],
        anchors: [...current.anchors, { id: anchorId, nodeId: current.activeNodeId, messageId: eventId, segmentId: current.segments[0].id, selectedText: '验证事件', startOffset: 3, endOffset: 7, createdAt }],
        discussionEdges: [...current.discussionEdges, { id: edgeId, source: current.activeNodeId, target: branchId, relation: 'derived-from', anchorId, label: '从内容锚点派生', createdAt }],
      }));
      expect(updated.auditEvents.at(-1)).toMatchObject({ action: 'workspace.updated', entityType: 'workspace', metadata: expect.objectContaining({ backend: 'postgres' }) });

      const recovered = await new PostgresWorkspaceStore(database, projectId).read();
      expect(recovered.mode).toBe('Strict');
      expect(recovered.messages.at(-1)).toMatchObject({ id: eventId, text: '持久化验证事件', segmentId: recovered.segments[0].id });
      expect(recovered.anchors).toContainEqual(expect.objectContaining({ id: anchorId, messageId: eventId, selectedText: '验证事件', startOffset: 3, endOffset: 7 }));
      expect(recovered.discussionEdges).toContainEqual(expect.objectContaining({ id: edgeId, target: branchId, anchorId }));
      expect(recovered.auditEvents).toHaveLength(1);
    } finally {
      await database.close();
    }
  });

  it('recovers 1000+ Events in stable database order with indexed access paths', async () => {
    const database = await migratedDatabase();
    try {
      const projectId = randomUUID();
      const store = new PostgresWorkspaceStore(database, projectId);
      const seeded = await store.read();
      await database.query(`
        INSERT INTO rhiza_messages (id, node_id, segment_id, kind, body, created_at)
        SELECT md5($1 || value::text)::uuid, $2, $3, 'user', 'event-' || value, now()
        FROM generate_series(1, 1000) AS value
      `, [projectId, seeded.activeNodeId, seeded.segments[0].id]);

      const recovered = await store.read();
      expect(recovered.messages).toHaveLength(1002);
      expect(recovered.messages.slice(-3).map(event => event.text)).toEqual(['event-998', 'event-999', 'event-1000']);
      const indexes = await database.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE tablename = 'rhiza_messages'");
      expect(indexes.rows.map(row => row.indexname)).toEqual(expect.arrayContaining(['rhiza_messages_node_event_ordinal_key', 'rhiza_messages_node_idx']));
    } finally {
      await database.close();
    }
  });

  it('rejects ordinary history omission and Manifest rewrites', async () => {
    const database = await migratedDatabase();
    try {
      const projectId = randomUUID();
      const store = new PostgresWorkspaceStore(database, projectId);
      const seeded = await store.read();
      const createdAt = new Date().toISOString();
      const messageId = randomUUID();
      const manifest: ContextManifest = {
        id: randomUUID(), projectId, nodeId: seeded.activeNodeId, requestId: randomUUID(), createdAt,
        mode: 'Assisted', provider: 'Test', model: 'original-model', runtime: 'provider-adapter',
        contextItemIds: [], excludedItemIds: [], contextItems: [], estimatedTokens: 0,
        generation: { temperature: 0.4, topP: 1, maxTokens: 1024 }, operation: 'send', attachmentIds: [],
      };
      await store.update(current => ({
        ...current,
        manifests: [...current.manifests, manifest],
        messages: [...current.messages, { id: messageId, nodeId: current.activeNodeId, kind: 'assistant', text: '必须保留的历史', manifestId: manifest.id, createdAt }],
      }));
      await expect(store.update(current => ({
        ...current,
        manifests: current.manifests.map(item => item.id === manifest.id ? { ...item, model: 'attempted-rewrite' } : item),
      }))).rejects.toThrow(`Immutable Manifest ${manifest.id} cannot be rewritten`);
      await expect(database.query('UPDATE rhiza_context_manifests SET manifest = $2::jsonb WHERE id = $1', [manifest.id, JSON.stringify({ ...manifest, model: 'direct-rewrite' })]))
        .rejects.toThrow('rhiza_context_manifests are immutable');
      await expect(database.query('DELETE FROM rhiza_context_manifests WHERE id = $1', [manifest.id]))
        .rejects.toThrow('authorized purge');
      await expect(store.update(current => ({
        ...current,
        messages: current.messages.filter(message => message.id !== messageId),
        manifests: current.manifests.filter(item => item.id !== manifest.id),
      }))).rejects.toThrow('explicit purge capability');

      const recovered = await new PostgresWorkspaceStore(database, projectId).read();
      expect(recovered.messages).toContainEqual(expect.objectContaining({ id: messageId, text: '必须保留的历史', manifestId: manifest.id }));
      expect(recovered.manifests).toContainEqual(expect.objectContaining({ id: manifest.id, model: 'original-model' }));
    } finally {
      await database.close();
    }
  }, 30_000);

  it('purges only an archived leaf with a retained node.purged receipt', async () => {
    const database = await migratedDatabase();
    try {
      const projectId = randomUUID();
      const store = new PostgresWorkspaceStore(database, projectId);
      await store.read();
      const createdAt = new Date().toISOString();
      const nodeId = randomUUID();
      const manifestId = randomUUID();
      const messageId = randomUUID();
      const receiptId = randomUUID();
      const manifest: ContextManifest = {
        id: manifestId, projectId, nodeId, requestId: randomUUID(), createdAt,
        mode: 'Assisted', provider: 'Test', model: 'purge-model', runtime: 'provider-adapter',
        contextItemIds: [], excludedItemIds: [], contextItems: [], estimatedTokens: 0,
        generation: { temperature: 0.4, topP: 1, maxTokens: 1024 }, operation: 'send', attachmentIds: [],
      };
      await store.update(current => ({
        ...current,
        discussionNodes: [...current.discussionNodes, {
          id: nodeId, title: '可清除的归档叶节点', summary: 'Purge E2E', status: 'archived', kind: 'branch',
          sourceNodeId: current.activeNodeId, x: 640, y: 280, createdAt, updatedAt: createdAt,
        }],
        manifests: [...current.manifests, manifest],
        messages: [...current.messages, { id: messageId, nodeId, kind: 'assistant', text: '随节点清除的历史', manifestId, createdAt }],
      }));

      await expect(store.update(current => ({
        ...current,
        discussionNodes: current.discussionNodes.filter(node => node.id !== nodeId),
        messages: current.messages.filter(message => message.nodeId !== nodeId),
        manifests: current.manifests.filter(item => item.nodeId !== nodeId),
      }))).rejects.toThrow('explicit purge capability');

      await store.update(current => ({
        ...current,
        discussionNodes: current.discussionNodes.filter(node => node.id !== nodeId),
        messages: current.messages.filter(message => message.nodeId !== nodeId),
        manifests: current.manifests.filter(item => item.nodeId !== nodeId),
        auditEvents: [...current.auditEvents, {
          id: receiptId, projectId, nodeId, action: 'node.purged', entityType: 'node', entityId: nodeId,
          metadata: { reason: 'M01 controlled purge test' }, createdAt,
        }],
      }), { purge: { nodeId, auditReceiptId: receiptId } });

      const recovered = await new PostgresWorkspaceStore(database, projectId).read();
      expect(recovered.discussionNodes).not.toContainEqual(expect.objectContaining({ id: nodeId }));
      expect(recovered.messages).not.toContainEqual(expect.objectContaining({ id: messageId }));
      expect(recovered.manifests).not.toContainEqual(expect.objectContaining({ id: manifestId }));
      expect(recovered.auditEvents).toContainEqual(expect.objectContaining({
        id: receiptId, action: 'node.purged', entityId: nodeId, nodeId: undefined,
      }));
    } finally {
      await database.close();
    }
  }, 30_000);
});
