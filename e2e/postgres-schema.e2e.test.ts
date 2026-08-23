// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PostgreSQL schema E2E', () => {
  it('creates and rolls back the complete baseline in an embedded PostgreSQL engine', async () => {
    const database = new PGlite();
    try {
      await database.exec(await readFile(resolve('db/migrations/0001_rhiza_core.up.sql'), 'utf8'));
      await database.exec(await readFile(resolve('db/migrations/0002_chat_parity.up.sql'), 'utf8'));
      await database.exec(await readFile(resolve('db/migrations/0003_domain_persistence.up.sql'), 'utf8'));
      await database.exec(await readFile(resolve('db/migrations/0004_immutable_manifest_history.up.sql'), 'utf8'));
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
        'rhiza_segments',
      ]);

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
