import type { ManagedBackup, ManagedBackupLifecyclePort } from '../application/ports/managed-backup';
import type { BundleExport, PortableWorkspaceFacts } from '../application/ports/portable-workspace';
import type { CommandFactContext } from '../domain-journal';
import { BUNDLE_LIMITS } from '../domain/portable-bundle';
import type { SqlQueryable } from '../postgres-store';
import type { NodeImportArchiveStore } from './portable-content';

type Row = { workspace_id: string; backup_id: string; owner_id: string; status: ManagedBackup['status']; purge_generation: string | number;
  archive_digest: string | null; state_digest: string | null; size_bytes: string | number | null; retry_of: string | null; error_code: string | null;
  started_at: Date | string; updated_at: Date | string; completed_at: Date | string | null };
const failure = (code: string, status = 409) => Object.assign(new Error(code), { code, status });
const iso = (value: Date | string) => new Date(value).toISOString();
function record(row: Row): ManagedBackup {
  return { backupId: row.backup_id, workspaceId: row.workspace_id, ownerId: row.owner_id, status: row.status,
    location: `managed://${row.workspace_id}/${encodeURIComponent(row.backup_id)}`, startedAt: iso(row.started_at), updatedAt: iso(row.updated_at),
    ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}), ...(row.retry_of ? { retryOf: row.retry_of } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}), ...(row.archive_digest ? { archiveDigest: row.archive_digest, stateDigest: row.state_digest!, sizeBytes: Number(row.size_bytes) } : {}) };
}

/** Dedicated Application/UoW operational lifecycle. It never writes business history or creates an import checkpoint. */
export class SqlManagedBackups implements ManagedBackupLifecyclePort {
  constructor(private readonly workspaceId: string,
    private readonly transaction: <T>(operation: (database: SqlQueryable) => Promise<T>) => Promise<T>,
    private readonly readFacts: (database: SqlQueryable) => Promise<PortableWorkspaceFacts>,
    private readonly reserveCommand: (database: SqlQueryable, context: CommandFactContext) => Promise<void>,
    private readonly archives?: NodeImportArchiveStore) {}

  private async lock(database: SqlQueryable, ownerId: string) {
    await database.query("SELECT pg_advisory_xact_lock(hashtext('rhiza:workspace-write:' || $1))", [this.workspaceId]);
    if (!(await database.query("SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 AND role='owner'", [this.workspaceId, ownerId])).rows.length) throw failure('WORKSPACE_OWNER_REQUIRED', 403);
  }
  private context(context: CommandFactContext) {
    if (context.commandType !== 'CreateManagedBackup' || context.actor.actorType !== 'human'
      || context.scope.scopeType !== 'workspace' || context.scope.scopeId !== this.workspaceId) throw failure('BACKUP_COMMAND_CONTEXT_REQUIRED', 403);
  }
  private async row(database: SqlQueryable, ownerId: string, backupId: string) {
    return (await database.query<Row>('SELECT * FROM managed_backups WHERE workspace_id=$1 AND owner_id=$2 AND backup_id=$3', [this.workspaceId, ownerId, backupId])).rows[0];
  }
  private async generation(database: SqlQueryable) {
    return Number((await database.query<{ count: string }>('SELECT count(*) FROM purge_checkpoints WHERE workspace_id=$1', [this.workspaceId])).rows[0].count);
  }
  private async active(database: SqlQueryable, context: CommandFactContext): Promise<Row> {
    const row = await this.row(database, context.actor.actorId, context.commandId);
    if (!row || row.status !== 'running' || Number(row.purge_generation) !== await this.generation(database)) throw failure('BACKUP_PURGED');
    return row;
  }
  async begin(context: CommandFactContext, retryOf?: string) {
    this.context(context);
    if (!this.archives) throw failure('BACKUP_LOCATION_UNAVAILABLE', 503);
    return this.transaction(async database => {
      await this.lock(database, context.actor.actorId);
      const existing = await this.row(database, context.actor.actorId, context.commandId);
      if (existing) {
        if ((existing.retry_of ?? undefined) !== retryOf) throw failure('COMMAND_ID_CONFLICT');
        return { record: record(existing) };
      }
      if ((await database.query('SELECT 1 FROM command_receipts WHERE workspace_id=$1 AND command_id=$2', [this.workspaceId, context.commandId])).rows.length) throw failure('COMMAND_ID_CONFLICT');
      if (retryOf) {
        const prior = await this.row(database, context.actor.actorId, retryOf);
        if (!prior || !['failed', 'interrupted'].includes(prior.status)) throw failure('BACKUP_RETRY_UNAVAILABLE');
      }
      const facts = await this.readFacts(database);
      const inserted = await database.query<Row>(`INSERT INTO managed_backups(workspace_id,backup_id,owner_id,status,purge_generation,retry_of)
        VALUES ($1,$2,$3,'running',$4,$5) RETURNING *`, [this.workspaceId, context.commandId, context.actor.actorId, await this.generation(database), retryOf ?? null]);
      await this.reserveCommand(database, context);
      return { record: record(inserted.rows[0]), facts };
    });
  }
  async register(context: CommandFactContext, archive: { archiveDigest: string; stateDigest: string; sizeBytes: number }) {
    this.context(context);
    if (!/^[a-f0-9]{64}$/.test(archive.archiveDigest) || !/^[a-f0-9]{64}$/.test(archive.stateDigest)
      || !Number.isSafeInteger(archive.sizeBytes) || archive.sizeBytes <= 0 || archive.sizeBytes > BUNDLE_LIMITS.maxArchiveBytes) throw failure('BACKUP_ARCHIVE_INVALID');
    await this.transaction(async database => {
      await this.lock(database, context.actor.actorId);
      const current = await this.active(database, context);
      if (current.archive_digest && (current.archive_digest !== archive.archiveDigest || current.state_digest !== archive.stateDigest || Number(current.size_bytes) !== archive.sizeBytes)) throw failure('BACKUP_ARCHIVE_CONFLICT');
      await database.query("SELECT pg_advisory_xact_lock(hashtext('rhiza:import-archive:' || $1))", [archive.archiveDigest]);
      await database.query(`UPDATE managed_backups SET archive_digest=$4,state_digest=$5,size_bytes=$6,updated_at=now()
        WHERE workspace_id=$1 AND owner_id=$2 AND backup_id=$3`, [this.workspaceId, context.actor.actorId, context.commandId, archive.archiveDigest, archive.stateDigest, archive.sizeBytes]);
    });
  }
  async publish(context: CommandFactContext, retain: () => Promise<void>) {
    this.context(context);
    return this.transaction(async database => {
      await this.lock(database, context.actor.actorId);
      const current = await this.active(database, context);
      if (!current.archive_digest || !this.archives) throw failure('BACKUP_ARCHIVE_NOT_REGISTERED');
      await database.query("SELECT pg_advisory_xact_lock(hashtext('rhiza:import-archive:' || $1))", [current.archive_digest]);
      if ((await database.query(`SELECT 1 FROM purge_key_references k JOIN purge_checkpoints p ON p.purge_id=k.purge_id
        WHERE k.content_family='import-archive' AND k.entity_id=$1 AND p.phase='pending' LIMIT 1`, [current.archive_digest])).rows.length) throw failure('BACKUP_PURGED');
      await this.archives.releaseRevoked(current.archive_digest);
      // The registered digest has already committed. A failed final SQL commit cannot hide retained bytes from Purge.
      await retain();
      const updated = await database.query<Row>(`UPDATE managed_backups SET status='ready',completed_at=now(),updated_at=now()
        WHERE workspace_id=$1 AND owner_id=$2 AND backup_id=$3 RETURNING *`, [this.workspaceId, context.actor.actorId, context.commandId]);
      return record(updated.rows[0]);
    });
  }
  async fail(context: CommandFactContext, code: string) {
    this.context(context);
    return this.transaction(async database => {
      await this.lock(database, context.actor.actorId);
      const safe = code === 'BACKUP_LOCATION_UNAVAILABLE' ? code : 'BACKUP_FAILED';
      await database.query(`UPDATE managed_backups SET status='failed',error_code=$4,updated_at=now()
        WHERE workspace_id=$1 AND owner_id=$2 AND backup_id=$3 AND status='running'`, [this.workspaceId, context.actor.actorId, context.commandId, safe]);
      const current = await this.row(database, context.actor.actorId, context.commandId);
      if (!current) throw failure('BACKUP_NOT_FOUND', 404);
      return record(current);
    });
  }
  async list(ownerId: string) {
    return this.transaction(async database => {
      await this.lock(database, ownerId);
      const rows = await database.query<Row>('SELECT * FROM managed_backups WHERE workspace_id=$1 AND owner_id=$2 ORDER BY started_at DESC,backup_id LIMIT 50', [this.workspaceId, ownerId]);
      const latest = await database.query<{ completed_at: Date | string }>("SELECT completed_at FROM managed_backups WHERE workspace_id=$1 AND owner_id=$2 AND status='ready' ORDER BY completed_at DESC LIMIT 1", [this.workspaceId, ownerId]);
      const next = latest.rows[0] ? new Date(new Date(latest.rows[0].completed_at).getTime() + 7 * 86400000) : undefined;
      return { backups: rows.rows.map(record), reminder: { due: !next || next.getTime() <= Date.now(), nextAt: next?.toISOString() ?? null, intervalDays: 7 as const } };
    });
  }
  async download(ownerId: string, backupId: string): Promise<BundleExport> {
    // Keep the Workspace/content/digest locks until disposal, including backpressure and client disconnect.
    // A Purge cannot commit while an in-process reader still holds readable backup bytes.
    let release!: () => void;
    const finished = new Promise<void>(resolve => { release = resolve; });
    let resolveReady!: (bundle: BundleExport) => void;
    let rejectReady!: (error: unknown) => void;
    const ready = new Promise<BundleExport>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const transaction = this.transaction(async database => {
      await this.lock(database, ownerId);
      const current = await this.row(database, ownerId, backupId);
      if (!current) throw failure('BACKUP_NOT_FOUND', 404);
      if (current.status !== 'ready' || !current.archive_digest || !this.archives) throw failure('BACKUP_NOT_READY');
      await database.query("SELECT pg_advisory_xact_lock(hashtext('rhiza:import-archive:' || $1))", [current.archive_digest]);
      const archive = await this.archives.download(current.archive_digest);
      resolveReady({ ...archive, dispose: async () => { release(); await transaction; } });
      try { await finished; } finally { await archive.dispose(); }
    });
    void transaction.catch(rejectReady);
    return ready;
  }
}
