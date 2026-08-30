import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';

interface Migration {
  version: string;
  name: string;
  checksum: string;
  sql: string;
}

const migrationsDirectory = resolve('db/migrations');

export async function loadMigrations(): Promise<Migration[]> {
  const files = (await readdir(migrationsDirectory))
    .filter(file => /^\d+_[a-z0-9_]+\.up\.sql$/.test(file))
    .sort();
  return Promise.all(files.map(async file => {
    const sql = await readFile(resolve(migrationsDirectory, file), 'utf8');
    const [version] = file.split('_');
    return {
      version,
      name: file.replace(/\.up\.sql$/, ''),
      checksum: createHash('sha256').update(sql).digest('hex'),
      sql,
    };
  }));
}

export async function migrate(databaseUrl: string): Promise<string[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS rhiza_schema_migrations (
        version text PRIMARY KEY,
        name text NOT NULL,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const migrations = await loadMigrations();
    const applied = await client.query<{ version: string; checksum: string }>('SELECT version, checksum FROM rhiza_schema_migrations ORDER BY version');
    const appliedByVersion = new Map(applied.rows.map(row => [row.version, row.checksum]));
    const completed: string[] = [];

    for (const migration of migrations) {
      const existingChecksum = appliedByVersion.get(migration.version);
      if (existingChecksum && existingChecksum !== migration.checksum) {
        throw new Error(`Migration ${migration.version} checksum differs from the applied migration`);
      }
      if (existingChecksum) continue;

      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO rhiza_schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [migration.version, migration.name, migration.checksum],
        );
        await client.query('COMMIT');
        completed.push(migration.name);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return completed;
  } finally {
    await client.end();
  }
}

export async function migrationStatus(databaseUrl: string) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const migrations = await loadMigrations();
    const table = await client.query<{ exists: boolean }>("SELECT to_regclass('rhiza_schema_migrations') IS NOT NULL AS exists");
    if (!table.rows[0]?.exists) return migrations.map(item => ({ ...item, applied: false }));
    const applied = await client.query<{ version: string }>('SELECT version FROM rhiza_schema_migrations');
    const versions = new Set(applied.rows.map(row => row.version));
    return migrations.map(item => ({ ...item, applied: versions.has(item.version) }));
  } finally {
    await client.end();
  }
}

async function main() {
  const command = process.argv[2] || 'up';
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (command === 'up') {
    const completed = await migrate(databaseUrl);
    console.info(completed.length ? `Applied migrations: ${completed.join(', ')}` : 'Database is already up to date.');
    return;
  }
  if (command === 'status') {
    for (const migration of await migrationStatus(databaseUrl)) {
      console.info(`${migration.applied ? 'up' : 'down'} ${migration.name}`);
    }
    return;
  }
  throw new Error(`Unknown migration command: ${command}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
