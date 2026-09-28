import { resolve } from 'node:path';
import { Pool } from 'pg';
import { auditLegacyFileReplicas } from '../server/infrastructure/legacy-file-audit';

if (!process.env.DATABASE_URL || !process.env.RHIZA_UPLOAD_DIR) {
  throw new Error('M09 file audit requires DATABASE_URL and RHIZA_UPLOAD_DIR for the same stopped deployment');
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
let locked = false;
try {
  const lock = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock(hashtext('rhiza:chat-runtime')) acquired");
  if (!lock.rows[0]?.acquired) throw new Error('Another Rhiza Chat runtime is active for this database');
  locked = true;
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  let counts: Awaited<ReturnType<typeof auditLegacyFileReplicas>>;
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('rhiza:content-lifecycle'))");
    const resources = await client.query<{ digest: string }>('SELECT DISTINCT digest FROM rhiza_resource_versions');
    const attachments = await client.query<{ storage_key: string }>('SELECT DISTINCT storage_key FROM rhiza_attachments');
    const archives = await client.query<{ archive_digest: string }>('SELECT DISTINCT archive_digest FROM bundle_imports');
    counts = await auditLegacyFileReplicas(resolve(process.env.RHIZA_UPLOAD_DIR), {
      resourceDigests: resources.rows.map(row => row.digest), attachmentKeys: attachments.rows.map(row => row.storage_key),
      archiveDigests: archives.rows.map(row => row.archive_digest),
    });
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  console.info(JSON.stringify({ scope: 'all-workspaces', knownPlaintextFileReplicas: counts }));
  if (Object.values(counts).some(count => count !== 0)) throw new Error('M09_LEGACY_FILE_REPLICAS_REMAIN');
} finally {
  if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('rhiza:chat-runtime'))");
  client.release();
  await pool.end();
}
