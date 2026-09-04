import { randomUUID } from 'node:crypto';
import type { SqlQueryable } from '../postgres-store';
import type { ProjectedObject, ProjectedRelation, WorkspaceGraphProjection } from './model';

interface TransactionalGraphSql extends SqlQueryable {
  transaction?<T>(callback: (transaction: SqlQueryable) => Promise<T>): Promise<T>;
  connect?(): Promise<SqlQueryable & { release(): void }>;
}

const asIso = (value: unknown) => value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();

/** PostgreSQL/PGlite adapter for the rebuildable graph-v1 projection namespace. */
export class PostgresGraphProjectionAdapter {
  constructor(private readonly database: TransactionalGraphSql, private readonly workspaceId: string) {}

  private async transaction<T>(work: (database: SqlQueryable) => Promise<T>): Promise<T> {
    if (this.database.transaction) return this.database.transaction(work);
    if (!this.database.connect) {
      await this.database.query('BEGIN');
      try { const result = await work(this.database); await this.database.query('COMMIT'); return result; }
      catch (error) { await this.database.query('ROLLBACK'); throw error; }
    }
    const connection = await this.database.connect();
    try { await connection.query('BEGIN'); const result = await work(connection); await connection.query('COMMIT'); return result; }
    catch (error) { await connection.query('ROLLBACK'); throw error; }
    finally { connection.release(); }
  }

  async materialize(projection: WorkspaceGraphProjection, force = false): Promise<WorkspaceGraphProjection> {
    const alias = await this.database.query<{ active_version: string }>("SELECT active_version FROM projection_aliases WHERE workspace_id=$1 AND projection_name='graph'", [this.workspaceId]);
    const activeVersion = alias.rows[0]?.active_version;
    if (!force && activeVersion) {
      const checkpoint = await this.database.query<{ last_sequence: number; semantic_checksum: string }>("SELECT last_sequence,semantic_checksum FROM projection_checkpoints WHERE workspace_id=$1 AND projection_name='graph' AND projection_version=$2", [this.workspaceId, activeVersion]);
      if (Number(checkpoint.rows[0]?.last_sequence) === projection.checkpoint && checkpoint.rows[0]?.semantic_checksum === projection.checksum) return this.load(activeVersion);
    }
    // Normal checkpoint advances update the active namespace in one transaction.
    // Explicit rebuilds use a fresh namespace and switch the alias only after it is complete.
    const version = activeVersion && !force
      ? activeVersion
      : `graph-v1-${projection.checkpoint}-${projection.checksum.slice(0, 12)}-${randomUUID().slice(0, 8)}`;
    await this.transaction(async database => {
      await database.query(`INSERT INTO graph_layouts (workspace_id,layout_id,owner_scope) VALUES ($1,'default',$2::jsonb) ON CONFLICT DO NOTHING`, [this.workspaceId, JSON.stringify({ scopeType: 'workspace', scopeId: this.workspaceId })]);
      for (const object of projection.objects) if (object.layout) await database.query(`INSERT INTO graph_layout_nodes
        (workspace_id,layout_id,object_type,object_id,x,y,collapsed) VALUES ($1,'default',$2,$3,$4,$5,$6)
        ON CONFLICT (workspace_id,layout_id,object_type,object_id) DO UPDATE SET x=EXCLUDED.x,y=EXCLUDED.y,collapsed=EXCLUDED.collapsed`, [this.workspaceId, object.ref.objectType, object.ref.objectId, object.layout.x, object.layout.y, object.layout.collapsed ?? false]);
      await database.query('DELETE FROM graph_relations WHERE workspace_id=$1 AND projection_version=$2', [this.workspaceId, version]);
      await database.query('DELETE FROM workspace_objects WHERE workspace_id=$1 AND projection_version=$2', [this.workspaceId, version]);
      for (const object of projection.objects) await database.query(`INSERT INTO workspace_objects
        (workspace_id,projection_version,object_type,object_id,revision,lifecycle_status,title,summary,kind,object_status,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [this.workspaceId, version, object.ref.objectType, object.ref.objectId, object.revision, object.lifecycle, object.title, object.summary, object.kind, object.status, object.createdAt, object.updatedAt]);
      for (const relation of projection.relations) await database.query(`INSERT INTO graph_relations
        (workspace_id,projection_version,relation_id,source_type,source_id,target_type,target_id,relation_type,lifecycle_status,label,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [this.workspaceId, version, relation.id, relation.source.objectType, relation.source.objectId, relation.target.objectType, relation.target.objectId, relation.relationType, relation.lifecycle, relation.label, relation.createdAt]);
      await database.query(`INSERT INTO projection_checkpoints (workspace_id,projection_name,projection_version,last_sequence,semantic_checksum)
        VALUES ($1,'graph',$2,$3,$4) ON CONFLICT (workspace_id,projection_name,projection_version) DO UPDATE
        SET last_sequence=EXCLUDED.last_sequence,semantic_checksum=EXCLUDED.semantic_checksum,updated_at=now()`, [this.workspaceId, version, projection.checkpoint, projection.checksum]);
      await database.query(`INSERT INTO projection_aliases (workspace_id,projection_name,active_version) VALUES ($1,'graph',$2)
        ON CONFLICT (workspace_id,projection_name) DO UPDATE SET active_version=EXCLUDED.active_version,updated_at=now()`, [this.workspaceId, version]);
    });
    return this.load(version);
  }

  async load(version?: string): Promise<WorkspaceGraphProjection> {
    const selected = version ?? (await this.database.query<{ active_version: string }>("SELECT active_version FROM projection_aliases WHERE workspace_id=$1 AND projection_name='graph'", [this.workspaceId])).rows[0]?.active_version;
    if (!selected) throw new Error('Graph projection has not been materialized');
    const [objectRows, relationRows, layoutRows, checkpointRows] = await Promise.all([
      this.database.query<Record<string, unknown>>('SELECT * FROM workspace_objects WHERE workspace_id=$1 AND projection_version=$2 ORDER BY object_type,object_id', [this.workspaceId, selected]),
      this.database.query<Record<string, unknown>>('SELECT * FROM graph_relations WHERE workspace_id=$1 AND projection_version=$2 ORDER BY relation_id', [this.workspaceId, selected]),
      this.database.query<Record<string, unknown>>("SELECT * FROM graph_layout_nodes WHERE workspace_id=$1 AND layout_id='default'", [this.workspaceId]),
      this.database.query<{ last_sequence: number; semantic_checksum: string }>("SELECT last_sequence,semantic_checksum FROM projection_checkpoints WHERE workspace_id=$1 AND projection_name='graph' AND projection_version=$2", [this.workspaceId, selected]),
    ]);
    const layouts = new Map(layoutRows.rows.map(row => [`${String(row.object_type)}\u0000${String(row.object_id)}`, { x: Number(row.x), y: Number(row.y), collapsed: Boolean(row.collapsed) }]));
    const objects: ProjectedObject[] = objectRows.rows.map(row => ({
      ref: { workspaceId: this.workspaceId, objectType: String(row.object_type), objectId: String(row.object_id) }, revision: Number(row.revision),
      lifecycle: row.lifecycle_status as ProjectedObject['lifecycle'], title: String(row.title), summary: String(row.summary), kind: String(row.kind), status: String(row.object_status),
      createdAt: asIso(row.created_at), updatedAt: asIso(row.updated_at), layout: layouts.get(`${String(row.object_type)}\u0000${String(row.object_id)}`),
    }));
    const relations: ProjectedRelation[] = relationRows.rows.map(row => ({
      id: String(row.relation_id), source: { workspaceId: this.workspaceId, objectType: String(row.source_type), objectId: String(row.source_id) },
      target: { workspaceId: this.workspaceId, objectType: String(row.target_type), objectId: String(row.target_id) }, relationType: String(row.relation_type),
      lifecycle: row.lifecycle_status as ProjectedRelation['lifecycle'], label: String(row.label), createdAt: asIso(row.created_at),
    }));
    const checkpoint = checkpointRows.rows[0];
    return { workspaceId: this.workspaceId, version: 'graph-v1', checkpoint: Number(checkpoint?.last_sequence ?? 0), checksum: checkpoint?.semantic_checksum ?? '', objects, relations };
  }
}
