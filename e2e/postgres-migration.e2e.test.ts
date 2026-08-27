// @vitest-environment node
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { migrate, migrationStatus } from '../scripts/migrate';

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('PostgreSQL migration E2E', () => {
  it('creates the Rhiza schema and is idempotent', async () => {
    expect(await migrate(databaseUrl!)).toEqual(['0001_rhiza_core', '0002_chat_parity', '0003_domain_persistence', '0004_immutable_manifest_history', '0005_identity_workspace_scope']);
    expect(await migrate(databaseUrl!)).toEqual([]);
    const firstStatus = await migrationStatus(databaseUrl!);
    expect(firstStatus).toEqual([
      expect.objectContaining({ version: '0001', applied: true }),
      expect.objectContaining({ version: '0002', applied: true }),
      expect.objectContaining({ version: '0003', applied: true }),
      expect.objectContaining({ version: '0004', applied: true }),
      expect.objectContaining({ version: '0005', applied: true }),
    ]);
    expect(await migrationStatus(databaseUrl!)).toEqual(firstStatus);

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const result = await client.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name LIKE 'rhiza_%'
        ORDER BY table_name
      `);
      expect(result.rows.map(row => row.table_name)).toEqual(expect.arrayContaining([
        'rhiza_projects',
        'rhiza_nodes',
        'rhiza_segments',
        'rhiza_messages',
        'rhiza_anchors',
        'rhiza_edges',
        'rhiza_context_manifests',
        'rhiza_schema_migrations',
        'rhiza_attachments',
        'rhiza_message_attachments',
        'rhiza_audit_events',
      ]));
      const scopeTables = await client.query<{ name: string }>(`
        SELECT unnest(ARRAY['users', 'workspaces', 'workspace_members']) AS name
        EXCEPT
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
      `);
      expect(scopeTables.rows).toEqual([]);
      const localOwner = await client.query<{ user_id: string; display_name: string }>(`
        SELECT user_id, display_name FROM users
        WHERE user_id = '00000000-0000-4000-8000-000000000002'
      `);
      expect(localOwner.rows).toEqual([{ user_id: '00000000-0000-4000-8000-000000000002', display_name: 'Local user' }]);
      const backfill = await client.query<{ project_id: string; workspace_id: string; user_id: string; role: string }>(`
        SELECT p.id AS project_id, w.workspace_id, m.user_id, m.role
        FROM rhiza_projects p
        LEFT JOIN workspaces w ON w.workspace_id = p.id
        LEFT JOIN workspace_members m ON m.workspace_id = w.workspace_id
        ORDER BY p.id
      `);
      expect(backfill.rows).toEqual(expect.arrayContaining(backfill.rows.map(row => expect.objectContaining({
        project_id: row.workspace_id,
        user_id: '00000000-0000-4000-8000-000000000002',
        role: 'owner',
      }))));
      const dangling = await client.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM workspace_members m
        LEFT JOIN workspaces w ON w.workspace_id = m.workspace_id
        LEFT JOIN users u ON u.user_id = m.user_id
        WHERE w.workspace_id IS NULL OR u.user_id IS NULL
      `);
      expect(dangling.rows[0]?.count).toBe(0);
    } finally {
      await client.end();
    }
  });
});
