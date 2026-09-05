// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

describe('PostgreSQL schema E2E', () => {
  it('creates and rolls back the complete baseline in an embedded PostgreSQL engine', async () => {
    const database = new PGlite();
    try {
      await database.exec(await readFile(resolve('db/migrations/0001_rhiza_core.up.sql'), 'utf8'));
      await database.exec(await readFile(resolve('db/migrations/0002_chat_parity.up.sql'), 'utf8'));
      await database.exec(await readFile(resolve('db/migrations/0003_domain_persistence.up.sql'), 'utf8'));
      await database.exec(await readFile(resolve('db/migrations/0004_immutable_manifest_history.up.sql'), 'utf8'));
      await database.exec("INSERT INTO rhiza_projects (id,title,state) VALUES ('00000000-0000-4000-8000-000000000001','Legacy','{}')");
      const m03 = await readFile(resolve('db/migrations/0005_identity_workspace_scope.up.sql'), 'utf8');
      // Simulate an interrupted bootstrap: user exists but no workspace/member rows.
      await database.exec("CREATE TABLE users (user_id uuid PRIMARY KEY, display_name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()); INSERT INTO users (user_id,display_name) VALUES ('00000000-0000-4000-8000-000000000002','Local user')");
      await database.exec(m03);
      await database.exec(await readFile(resolve('db/migrations/0006_resource_blob_host.up.sql'), 'utf8'));
      await database.exec(await readFile(resolve('db/migrations/0007_domain_journal_facts.up.sql'), 'utf8'));
      await database.exec(await readFile(resolve('db/migrations/0009_graph_projection.up.sql'), 'utf8'));
  await database.exec(await readFile(resolve('db/migrations/0010_graph_object_metadata.up.sql'), 'utf8'));
  await database.exec(await readFile(resolve('db/migrations/0011_context_candidate_index.up.sql'), 'utf8'));
  await database.exec(await readFile(resolve('db/migrations/0012_frozen_context.up.sql'), 'utf8'));
      const snapshot = async () => {
        const rows = await database.query(`SELECT w.workspace_id,w.name,w.status,w.created_by,m.user_id,m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.workspace_id ORDER BY w.workspace_id,m.user_id`);
        return createHash('sha256').update(JSON.stringify(rows.rows)).digest('hex');
      };
      const firstChecksum = await snapshot();
      await database.exec(m03);
      expect(await snapshot()).toBe(firstChecksum);
      const ownership = await database.query<{ workspace_id: string; user_id: string; role: string }>(`SELECT m.workspace_id,m.user_id,m.role FROM workspace_members m`);
      expect(ownership.rows).toEqual([{ workspace_id: '00000000-0000-4000-8000-000000000001', user_id: '00000000-0000-4000-8000-000000000002', role: 'owner' }]);
      const scopeTables = await database.query<{ name: string }>(`
        SELECT unnest(ARRAY['users', 'workspaces', 'workspace_members']) AS name
        EXCEPT
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      `);
      expect(scopeTables.rows).toEqual([]);
      const dangling = await database.query<{ count: number }>(`SELECT count(*)::int count FROM workspace_members m LEFT JOIN workspaces w ON w.workspace_id=m.workspace_id LEFT JOIN users u ON u.user_id=m.user_id WHERE w.workspace_id IS NULL OR u.user_id IS NULL`);
      expect(dangling.rows[0]?.count).toBe(0);
      const created = await database.query<{ tablename: string }>(`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename LIKE 'rhiza_%'
        ORDER BY tablename
      `);
      expect(created.rows.map(row => row.tablename)).toEqual([
        'rhiza_anchors',
        'rhiza_attachments',
        'rhiza_audit_events',
        'rhiza_context_manifests',
        'rhiza_edges',
        'rhiza_message_attachments',
        'rhiza_messages',
        'rhiza_nodes',
        'rhiza_projects',
        'rhiza_resource_materializations',
        'rhiza_resource_versions',
        'rhiza_resources',
        'rhiza_segments',
      ]);
      const journalTables = await database.query<{ tablename: string }>(`
        SELECT tablename FROM pg_tables
        WHERE schemaname='public' AND tablename IN ('workspace_event_heads','workspace_events','command_receipts')
        ORDER BY tablename
      `);
      expect(journalTables.rows.map(row => row.tablename)).toEqual(['command_receipts', 'workspace_event_heads', 'workspace_events']);
      const projectionTables = await database.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('workspace_objects','graph_relations','graph_layouts','graph_layout_nodes','projection_checkpoints','projection_aliases') ORDER BY tablename");
      expect(projectionTables.rows.map(row => row.tablename)).toEqual(['graph_layout_nodes', 'graph_layouts', 'graph_relations', 'projection_aliases', 'projection_checkpoints', 'workspace_objects']);

      await database.exec(await readFile(resolve('db/migrations/0012_frozen_context.down.sql'), 'utf8'));
      await database.exec(await readFile(resolve('db/migrations/0011_context_candidate_index.down.sql'), 'utf8'));
      await database.exec(await readFile(resolve('db/migrations/0010_graph_object_metadata.down.sql'), 'utf8'));
      await database.exec(await readFile(resolve('db/migrations/0009_graph_projection.down.sql'), 'utf8'));
      await database.exec(await readFile(resolve('db/migrations/0007_domain_journal_facts.down.sql'), 'utf8'));
      await database.exec(await readFile(resolve('db/migrations/0006_resource_blob_host.down.sql'), 'utf8'));
      await database.exec(await readFile(resolve('db/migrations/0005_identity_workspace_scope.down.sql'), 'utf8'));
      await database.exec(await readFile(resolve('db/migrations/0004_immutable_manifest_history.down.sql'), 'utf8'));
      await database.exec(await readFile(resolve('db/migrations/0003_domain_persistence.down.sql'), 'utf8'));
      await database.exec(await readFile(resolve('db/migrations/0002_chat_parity.down.sql'), 'utf8'));
      await database.exec(await readFile(resolve('db/migrations/0001_rhiza_core.down.sql'), 'utf8'));
      const remaining = await database.query<{ tablename: string }>(`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename LIKE 'rhiza_%'
      `);
      expect(remaining.rows).toEqual([]);
    } finally {
      await database.close();
    }
  });
});
