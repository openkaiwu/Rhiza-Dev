// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { loadMigrations } from '../scripts/migrate';
import { PostgresWorkspaceStore } from '../server/postgres-store';
import { semanticChecksum } from '../server/infrastructure/workspace-semantic-checksum';

it.skipIf(!process.env.DATABASE_URL)('migrates a populated PostgreSQL Workspace in bounded, repeatable batches', async () => {
  const connectionString = process.env.DATABASE_URL!;
  const admin = new Pool({ connectionString });
  const schema = `m09_migration_${randomUUID().replaceAll('-', '')}`;
  const directory = await mkdtemp(join(tmpdir(), 'rhiza-m09-migration-'));
  await admin.query(`CREATE SCHEMA ${schema}`);
  const scopedUrl = new URL(connectionString);
  scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
  const database = new Pool({ connectionString: scopedUrl.toString() });
  const workspaceId = randomUUID();
  const legacy = new PostgresWorkspaceStore(database, workspaceId);
  const sealed = PostgresWorkspaceStore.fromConnectionString(scopedUrl.toString(), workspaceId, directory);
  try {
    for (const migration of await loadMigrations()) await database.query(migration.sql);
    await legacy.read();
    await legacy.backfillJournal();
    const checksum = semanticChecksum(await legacy.read());
    const before = await legacy.auditLegacyPlaintextReplicas();
    for (const family of ['receipt_results', 'journal_payloads', 'messages', 'nodes', 'segments', 'context_items'] as const) {
      expect(before[family]).toBeGreaterThan(0);
    }
    await sealed.acquireRuntimeOwnership();
    const methods = [
      'sealLegacyReceiptResults', 'sealLegacyJournalPayloads', 'sealLegacyMessageContent',
      'sealLegacyNodeContent', 'sealLegacySegmentContent', 'sealLegacyContextItems',
    ] as const;
    for (const method of methods) {
      let migrated = 0;
      let batch: number;
      do { batch = await sealed[method](1); migrated += batch; } while (batch === 1);
      expect(migrated).toBe(before[{
        sealLegacyReceiptResults: 'receipt_results', sealLegacyJournalPayloads: 'journal_payloads',
        sealLegacyMessageContent: 'messages', sealLegacyNodeContent: 'nodes',
        sealLegacySegmentContent: 'segments', sealLegacyContextItems: 'context_items',
      }[method]]);
      expect(await sealed[method](1)).toBe(0);
    }
    expect(Object.values(await sealed.auditLegacyPlaintextReplicas()).every(count => count === 0)).toBe(true);
    expect(semanticChecksum(await sealed.read())).toBe(checksum);
  } finally {
    await sealed.close();
    await database.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
