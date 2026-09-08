import { access, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { loadMigrations } from '../scripts/migrate';
import { PostgresWorkspaceStore } from './postgres-store';
import { SealedReceiptContent } from './infrastructure/sealed-receipt-content';
import { SealedRunContent } from './infrastructure/sealed-run-content';
import { SealedJournalContent } from './infrastructure/sealed-journal-content';
import { SealedMessageContent } from './infrastructure/sealed-message-content';

/** Opens the durable local PostgreSQL-compatible adapter used when DATABASE_URL is absent. */
export async function openEmbeddedWorkspaceStore(dataDirectory = resolve('var/rhiza.pglite'), workspaceId?: string, migrationMode: 'apply' | 'verify' = 'apply'): Promise<PostgresWorkspaceStore> {
  if (migrationMode === 'verify') await access(join(dataDirectory, 'PG_VERSION'));
  else await mkdir(dirname(dataDirectory), { recursive: true });
  const database = new PGlite(dataDirectory);
  try {
    await database.waitReady;
    if (migrationMode === 'apply') await database.exec(`
      CREATE TABLE IF NOT EXISTS rhiza_schema_migrations (
        version text PRIMARY KEY,
        name text NOT NULL,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const applied = await database.query<{ version: string; checksum: string }>('SELECT version,checksum FROM rhiza_schema_migrations');
    const checksums = new Map(applied.rows.map(row => [row.version, row.checksum]));
    for (const migration of await loadMigrations()) {
      const existing = checksums.get(migration.version);
      if (existing && existing !== migration.checksum) throw new Error(`Migration ${migration.version} checksum differs from the embedded database`);
      if (existing) continue;
      if (migrationMode === 'verify') throw new Error(`Migration ${migration.version} is missing; reconciliation does not apply migrations`);
      await database.transaction(async transaction => {
        await transaction.exec(migration.sql);
        await transaction.query('INSERT INTO rhiza_schema_migrations (version,name,checksum) VALUES ($1,$2,$3)', [migration.version, migration.name, migration.checksum]);
      });
    }
    const contentDirectory = `${resolve(dataDirectory)}.content`;
    return new PostgresWorkspaceStore(database, workspaceId, SealedReceiptContent.atDirectory(contentDirectory), SealedRunContent.atDirectory(join(contentDirectory, 'runs')), SealedJournalContent.atDirectory(join(contentDirectory, 'journal')), SealedMessageContent.atDirectory(join(contentDirectory, 'messages')));
  } catch (error) {
    await database.close();
    throw error;
  }
}
