// @vitest-environment node
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { migrate, migrationStatus } from '../scripts/migrate';

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('PostgreSQL migration E2E', () => {
  it('creates the Rhiza schema and is idempotent', async () => {
    expect(await migrate(databaseUrl!)).toEqual(['0001_rhiza_core', '0002_chat_parity', '0003_domain_persistence', '0004_immutable_manifest_history']);
    expect(await migrate(databaseUrl!)).toEqual([]);
    expect(await migrationStatus(databaseUrl!)).toEqual([
      expect.objectContaining({ version: '0001', applied: true }),
      expect.objectContaining({ version: '0002', applied: true }),
      expect.objectContaining({ version: '0003', applied: true }),
      expect.objectContaining({ version: '0004', applied: true }),
    ]);

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
    } finally {
      await client.end();
    }
  });
});
