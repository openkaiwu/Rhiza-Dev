import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { loadMigrations } from '../scripts/migrate';
import { PostgresWorkspaceStore } from './postgres-store';

/** Opens the durable local PostgreSQL-compatible adapter used when DATABASE_URL is absent. */
export async function openEmbeddedWorkspaceStore(dataDirectory = resolve('var/rhiza.pglite'), workspaceId?: string): Promise<PostgresWorkspaceStore> {
  await mkdir(dirname(dataDirectory), { recursive: true });
  const database = new PGlite(dataDirectory);
  await database.waitReady;
  await database.exec(`
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
    await database.transaction(async transaction => {
      await transaction.exec(migration.sql);
      await transaction.query('INSERT INTO rhiza_schema_migrations (version,name,checksum) VALUES ($1,$2,$3)', [migration.version, migration.name, migration.checksum]);
    });
  }
  return new PostgresWorkspaceStore(database, workspaceId);
}
