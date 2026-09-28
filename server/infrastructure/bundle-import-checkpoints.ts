import type { SqlQueryable } from '../postgres-store';
import type { BundleImportCheckpoint, BundleImportCheckpointPort, BundleImportIdentity } from '../application/ports/bundle-import';

const columns = 'import_id AS "importId", owner_id AS "ownerId", workspace_id AS "workspaceId", archive_digest AS "archiveDigest", state_digest AS "stateDigest", phase, revision';
const conflict = () => Object.assign(new Error('BUNDLE_IMPORT_CONFLICT'), { code: 'BUNDLE_IMPORT_CONFLICT', status: 409 });

/** Metadata only. Activation will update this row inside the destination data transaction. */
export class SqlBundleImportCheckpoints implements BundleImportCheckpointPort {
  constructor(private readonly database: SqlQueryable) {}
  async begin(identity: BundleImportIdentity): Promise<BundleImportCheckpoint> {
    const result = await this.database.query<BundleImportCheckpoint>(`
      INSERT INTO bundle_imports(import_id,owner_id,workspace_id,archive_digest,state_digest)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (import_id) DO UPDATE SET import_id=bundle_imports.import_id
      WHERE bundle_imports.owner_id=EXCLUDED.owner_id AND bundle_imports.workspace_id=EXCLUDED.workspace_id
        AND bundle_imports.archive_digest=EXCLUDED.archive_digest AND bundle_imports.state_digest=EXCLUDED.state_digest
      RETURNING ${columns}`, [identity.importId, identity.ownerId, identity.workspaceId, identity.archiveDigest, identity.stateDigest]);
    if (!result.rows[0]) throw conflict();
    return result.rows[0];
  }
  async read(importId: string, ownerId: string): Promise<BundleImportCheckpoint | undefined> {
    const result = await this.database.query<BundleImportCheckpoint>(`SELECT ${columns} FROM bundle_imports WHERE import_id=$1 AND owner_id=$2`, [importId, ownerId]);
    return result.rows[0];
  }
  async markBlobsReady(importId: string, ownerId: string, expectedRevision: number): Promise<BundleImportCheckpoint> {
    const result = await this.database.query<BundleImportCheckpoint>(`UPDATE bundle_imports SET phase='blobs-ready',revision=revision+1,updated_at=now()
      WHERE import_id=$1 AND owner_id=$2 AND revision=$3 AND phase='validated' RETURNING ${columns}`, [importId, ownerId, expectedRevision]);
    if (!result.rows[0]) throw conflict();
    return result.rows[0];
  }
}
