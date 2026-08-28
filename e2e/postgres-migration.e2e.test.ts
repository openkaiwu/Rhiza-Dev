// @vitest-environment node
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { loadMigrations, migrate, migrationStatus } from '../scripts/migrate';

const databaseUrl = process.env.DATABASE_URL;
const localUserId = '00000000-0000-4000-8000-000000000002';
const legacyProjectId = '00000000-0000-4000-8000-000000000001';

describe.skipIf(!databaseUrl)('PostgreSQL migration E2E', () => {
  it('backfills a legacy project into the default workspace exactly once', async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const migrations = await loadMigrations();
      const apply = async (version: string) => {
        const migration = migrations.find(item => item.version === version);
        if (!migration) throw new Error(`missing migration ${version}`);
        await client.query('BEGIN');
        try {
          await client.query(migration.sql);
          await client.query('INSERT INTO rhiza_schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [migration.version, migration.name, migration.checksum]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      };

      await client.query('CREATE TABLE rhiza_schema_migrations (version text PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
      for (const version of ['0001', '0002', '0003', '0004']) await apply(version);
      await client.query("INSERT INTO rhiza_projects (id, title, state) VALUES ($1, 'Legacy default workspace', '{}'::jsonb)", [legacyProjectId]);
      await apply('0005');

      const backfill = await client.query<{ project_id: string; workspace_id: string; name: string; created_by: string; user_id: string; role: string }>(`
        SELECT p.id AS project_id, w.workspace_id, w.name, w.created_by, m.user_id, m.role
        FROM rhiza_projects p
        JOIN workspaces w ON w.workspace_id = p.id
        JOIN workspace_members m ON m.workspace_id = w.workspace_id
        ORDER BY p.id
      `);
      expect(backfill.rows).not.toEqual([]);
      expect(backfill.rows).toEqual([{ project_id: legacyProjectId, workspace_id: legacyProjectId, name: 'Legacy default workspace', created_by: localUserId, user_id: localUserId, role: 'owner' }]);
      const owner = await client.query<{ user_id: string; display_name: string }>('SELECT user_id, display_name FROM users WHERE user_id = $1', [localUserId]);
      expect(owner.rows).toEqual([{ user_id: localUserId, display_name: 'Local user' }]);
      const dangling = await client.query<{ count: number }>(`
        SELECT count(*)::int AS count FROM workspace_members m
        LEFT JOIN workspaces w ON w.workspace_id = m.workspace_id
        LEFT JOIN users u ON u.user_id = m.user_id
        WHERE w.workspace_id IS NULL OR u.user_id IS NULL
      `);
      expect(dangling.rows[0]?.count).toBe(0);
    } finally {
      await client.end();
    }

    expect(await migrate(databaseUrl!)).toEqual([]);
    expect((await migrationStatus(databaseUrl!)).map(({ version, applied }) => ({ version, applied }))).toEqual([
      { version: '0001', applied: true }, { version: '0002', applied: true }, { version: '0003', applied: true }, { version: '0004', applied: true }, { version: '0005', applied: true },
    ]);
  });
});
