import { createHash } from 'node:crypto';
import type { SqlQueryable } from '../postgres-store';
import type { GraphChangesInput, GraphChangesResult, GraphNeighborhoodInput, GraphQueryResult, ObjectRef, ProjectedObject, ProjectedRelation } from '../contracts/graph-projection';

const reject = (code: string, status = 400): never => { throw Object.assign(new Error(code), { code, status }); };
const key = (ref: ObjectRef) => `${ref.objectType}\u0000${ref.objectId}`;
const iso = (value: unknown) => new Date(String(value)).toISOString();
/** Read only a bounded page of the active namespace; never load the Workspace aggregate. */
export class BoundedGraphQueries {
  constructor(private readonly db: SqlQueryable, private readonly workspaceId: string) {}
  async head() {
    const row = (await this.db.query<{ active_version: string; last_sequence: number }>(`SELECT a.active_version,c.last_sequence FROM projection_aliases a JOIN projection_checkpoints c ON c.workspace_id=a.workspace_id AND c.projection_name=a.projection_name AND c.projection_version=a.active_version WHERE a.workspace_id=$1 AND a.projection_name='graph'`, [this.workspaceId])).rows[0];
    if (!row) reject('GRAPH_PROJECTION_UNAVAILABLE', 503);
    return { version: row.active_version, checkpoint: Number(row.last_sequence) };
  }
  private check(ref?: ObjectRef) { if (ref && ref.workspaceId !== this.workspaceId) reject('WORKSPACE_REFERENCE_MISMATCH', 409); }
  private objects(rows: Record<string, unknown>[]): ProjectedObject[] {
    return rows.map(row => ({ ref: { workspaceId: this.workspaceId, objectType: String(row.object_type), objectId: String(row.object_id), ...((row.metadata as { versionId?: string })?.versionId ? { versionId: (row.metadata as { versionId: string }).versionId } : {}) },
      revision: Number(row.revision), lifecycle: row.lifecycle_status as ProjectedObject['lifecycle'], title: String(row.title), summary: String(row.summary), kind: String(row.kind), status: String(row.object_status), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
      ...((row.metadata as { anchorText?: string })?.anchorText ? { anchorText: (row.metadata as { anchorText: string }).anchorText } : {}), ...(row.x != null ? { layout: { x: Number(row.x), y: Number(row.y), collapsed: Boolean(row.collapsed) } } : {}) }));
  }
  private relations(rows: Record<string, unknown>[]): ProjectedRelation[] {
    return rows.map(row => ({ id: String(row.relation_id), source: { workspaceId: this.workspaceId, objectType: String(row.source_type), objectId: String(row.source_id) }, target: { workspaceId: this.workspaceId, objectType: String(row.target_type), objectId: String(row.target_id) }, relationType: String(row.relation_type), lifecycle: row.lifecycle_status as ProjectedRelation['lifecycle'], label: String(row.label), createdAt: iso(row.created_at) }));
  }
  private async select(version: string, refs?: ObjectRef[], types?: string[], limit = 500, offset = 0, filters: GraphNeighborhoodInput = {}) {
    const rows = await this.db.query<Record<string, unknown>>(`SELECT o.*,l.x,l.y,l.collapsed FROM workspace_objects o LEFT JOIN graph_layout_nodes l ON l.workspace_id=o.workspace_id AND l.layout_id='default' AND l.object_type=o.object_type AND l.object_id=o.object_id WHERE o.workspace_id=$1 AND o.projection_version=$2 AND ($3::text[] IS NULL OR (o.object_type || chr(31) || o.object_id)=ANY($3)) AND ($4::text[] IS NULL OR o.object_type=ANY($4)) AND ($7::text[] IS NULL OR o.object_status=ANY($7)) AND ($8::text[] IS NULL OR o.lifecycle_status=ANY($8)) AND ($9::timestamptz IS NULL OR o.updated_at >= $9) AND ($10::text IS NULL OR position(lower($10) in lower(o.title || ' ' || o.summary))>0) ORDER BY o.object_type,o.object_id LIMIT $5 OFFSET $6`, [this.workspaceId, version, refs?.map(ref => `${ref.objectType}\x1f${ref.objectId}`) ?? null, types?.length ? types : null, limit, offset,filters.statuses?.length ? filters.statuses : null,filters.lifecycles?.length ? filters.lifecycles : null,filters.updatedAfter ?? null,filters.query?.trim() || null]);
    return this.objects(rows.rows).filter(object => !refs || refs.some(ref => key(ref)===key(object.ref)&&(!ref.versionId||ref.versionId===object.ref.versionId)));
  }
  async neighborhood(input: GraphNeighborhoodInput = {}): Promise<GraphQueryResult> {
    this.check(input.root);
    if(input.updatedAfter&&!Number.isFinite(Date.parse(input.updatedAfter)))reject('INVALID_GRAPH_DATE');
    if(input.query&&input.query.length>200)reject('INVALID_GRAPH_QUERY');
    const limit = input.nodeLimit ?? 200, edgeLimit = input.edgeLimit ?? 800, depth = input.depth ?? 1;
    if (![limit,edgeLimit,depth].every(Number.isSafeInteger) || limit < 1 || limit > 500 || edgeLimit < 0 || edgeLimit > 2000 || depth < 0 || depth > 3) reject('INVALID_GRAPH_LIMIT');
    const head = await this.head();
    const fingerprint = createHash('sha256').update(JSON.stringify([this.workspaceId,head.version,{ ...input,cursor:undefined }])).digest('hex').slice(0,24);
    let offset = 0, edgeOffset = 0;
    if (input.cursor) {
      let value!: { offset: number; edgeOffset: number; checkpoint: number; fingerprint: string };
      try { value = JSON.parse(Buffer.from(input.cursor,'base64url').toString()); } catch { reject('INVALID_GRAPH_CURSOR'); }
      if (![value.offset,value.edgeOffset].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 10_000_000)) reject('INVALID_GRAPH_CURSOR');
      if (value.checkpoint !== head.checkpoint || value.fingerprint !== fingerprint) reject('GRAPH_CURSOR_STALE',409);
      offset = value.offset; edgeOffset = value.edgeOffset;
    }
    if (!input.root) {
      const objects = await this.select(head.version,undefined,input.objectTypes,limit+1,offset,input);
      const rows = await this.db.query<Record<string,unknown>>(`SELECT r.* FROM graph_relations r JOIN workspace_objects sa ON sa.workspace_id=r.workspace_id AND sa.projection_version=r.projection_version AND sa.object_type=r.source_type AND sa.object_id=r.source_id JOIN workspace_objects ta ON ta.workspace_id=r.workspace_id AND ta.projection_version=r.projection_version AND ta.object_type=r.target_type AND ta.object_id=r.target_id WHERE r.workspace_id=$1 AND r.projection_version=$2 AND ($3::text[] IS NULL OR (r.source_type=ANY($3) AND r.target_type=ANY($3))) AND ($6::text[] IS NULL OR r.relation_type=ANY($6)) AND ($7::text[] IS NULL OR (sa.object_status=ANY($7) AND ta.object_status=ANY($7))) AND ($8::text[] IS NULL OR (sa.lifecycle_status=ANY($8) AND ta.lifecycle_status=ANY($8))) AND ($9::timestamptz IS NULL OR (sa.updated_at >= $9 AND ta.updated_at >= $9)) AND ($10::text IS NULL OR (position(lower($10) in lower(sa.title || ' ' || sa.summary))>0 AND position(lower($10) in lower(ta.title || ' ' || ta.summary))>0)) ORDER BY r.relation_id LIMIT $4 OFFSET $5`,[this.workspaceId,head.version,input.objectTypes?.length ? input.objectTypes : null,edgeLimit ? edgeLimit+1 : 0,edgeOffset,input.relationTypes?.length ? input.relationTypes : null,input.statuses?.length ? input.statuses : null,input.lifecycles?.length ? input.lifecycles : null,input.updatedAfter ?? null,input.query?.trim() || null]);
      const more = objects.length > limit || rows.rows.length > edgeLimit;
      return { version:head.version,checkpoint:head.checkpoint,objects:objects.slice(0,limit),relations:this.relations(rows.rows.slice(0,edgeLimit)),...(more ? { nextCursor:Buffer.from(JSON.stringify({offset:offset+Math.min(objects.length,limit),edgeOffset:edgeOffset+Math.min(rows.rows.length,edgeLimit),checkpoint:head.checkpoint,fingerprint})).toString('base64url') } : {}) };
    }
    const objects = await this.select(head.version,[input.root],input.objectTypes,1,0,input);
    if (!objects.length) return {version:head.version,checkpoint:head.checkpoint,objects:[],relations:[]};
    const seen = new Map(objects.map(o => [key(o.ref),o])); const edges = new Map<string,ProjectedRelation>(); let frontier = objects.map(o => o.ref);
    for (let level=0;level<depth && frontier.length && seen.size<limit && edges.size<edgeLimit;level++) {
      const rows = await this.db.query<Record<string,unknown>>(`SELECT * FROM graph_relations WHERE workspace_id=$1 AND projection_version=$2 AND lifecycle_status='active' AND ((source_type || chr(31) || source_id)=ANY($3::text[]) OR (target_type || chr(31) || target_id)=ANY($3::text[])) AND ($4::text[] IS NULL OR (source_type=ANY($4) AND target_type=ANY($4))) AND ($6::text[] IS NULL OR relation_type=ANY($6)) ORDER BY relation_id LIMIT $5`,[this.workspaceId,head.version,frontier.map(ref=>`${ref.objectType}\x1f${ref.objectId}`),input.objectTypes?.length ? input.objectTypes : null,edgeLimit-edges.size,input.relationTypes?.length ? input.relationTypes : null]);
      const relations=this.relations(rows.rows); const refs=new Map<string,ObjectRef>();
      for(const edge of relations){edges.set(edge.id,edge);for(const ref of [edge.source,edge.target])if(!seen.has(key(ref)))refs.set(key(ref),ref);}
      const added=await this.select(head.version,[...refs.values()],input.objectTypes,limit-seen.size,0,input); frontier=added.map(o=>o.ref); for(const object of added)seen.set(key(object.ref),object);
    }
    return {version:head.version,checkpoint:head.checkpoint,objects:[...seen.values()],relations:[...edges.values()].filter(e=>seen.has(key(e.source))&&seen.has(key(e.target)))};
  }
  async changes(input: GraphChangesInput): Promise<GraphChangesResult> {
    if (!Number.isSafeInteger(input.cursor) || input.cursor < 0) reject('INVALID_GRAPH_CURSOR');
    const head = await this.head();
    // A delta feed without retained per-object revisions must request a bounded reset page.
    if (input.cursor === head.checkpoint) return { version: head.version, checkpoint: head.checkpoint, resetRequired: false, objects: [], relations: [] };
    const page = await this.neighborhood({ nodeLimit: input.limit ?? 200, edgeLimit: Math.min(2000,(input.limit ?? 200)*4) });
    return { ...page, resetRequired: true };
  }
  async path(from: ObjectRef,to: ObjectRef,nodeLimit=500): Promise<GraphQueryResult> {
    this.check(from);this.check(to);if(!Number.isSafeInteger(nodeLimit)||nodeLimit<1||nodeLimit>500)reject('INVALID_GRAPH_LIMIT');
    const head=await this.head();const objects=new Map<string,ProjectedObject>();const seen=new Set([key(from)]);const previous=new Map<string,{from:ObjectRef;edge:ProjectedRelation}>();let frontier=[from];
    while(frontier.length&&!objects.has(key(to))&&objects.size<nodeLimit){const next:ObjectRef[]=[];for(const ref of frontier){const page=await this.neighborhood({root:ref,depth:1,nodeLimit:Math.max(1,nodeLimit-objects.size),edgeLimit:Math.min(2000,nodeLimit*4)});for(const object of page.objects)objects.set(key(object.ref),object);for(const edge of page.relations){const other=key(edge.source)===key(ref)?edge.target:edge.source;if(!seen.has(key(other))&&seen.size<nodeLimit){seen.add(key(other));previous.set(key(other),{from:ref,edge});next.push(other);}}}frontier=next;}
    if(!objects.has(key(from))||!objects.has(key(to)))return{version:head.version,checkpoint:head.checkpoint,objects:[],relations:[]};
    const refs=[to];const edges:ProjectedRelation[]=[];while(key(refs[0])!==key(from)){const step=previous.get(key(refs[0]));if(!step)return{version:head.version,checkpoint:head.checkpoint,objects:[],relations:[]};refs.unshift(step.from);edges.unshift(step.edge);}
    return{version:head.version,checkpoint:head.checkpoint,objects:refs.map(ref=>objects.get(key(ref))!),relations:edges};
  }
}
