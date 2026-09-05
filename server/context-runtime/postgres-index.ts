import { createHash } from 'node:crypto';
import type { ContextItem, WorkspaceData } from '../domain';
import { tokenize, type PlannerCandidate } from '../context-planner';
import type { SqlQueryable } from '../postgres-store';
import type { CandidateIndexSnapshot, ContextPlanningInput, ContextSource } from './contracts';
import { LexicalContextContributor } from './lexical-contributor';

export const CANDIDATE_INDEX_VERSION = 'candidate-v1';
const sourceKey = (type: string, id: string) => `${type}:${id}`;
const itemKey = (item: ContextItem) => sourceKey(item.sourceType ?? 'reference', item.sourceId ?? item.id);
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const changed = <T extends { id: string }>(current: readonly T[], previous: readonly T[] = []) => {
  const before = new Map(previous.map(item => [item.id, JSON.stringify(item)]));
  const after = new Map(current.map(item => [item.id, JSON.stringify(item)]));
  return new Set([...before.keys(), ...after.keys()].filter(id => before.get(id) !== after.get(id)));
};

/** Runs inside the source write transaction; only affected sources are tokenized. */
export async function materializeContextCandidates(database: SqlQueryable, current: WorkspaceData, previous?: WorkspaceData) {
  const head = await database.query<{ index_version: string }>('SELECT index_version FROM context_candidate_heads WHERE workspace_id=$1', [current.projectId]);
  if (!head.rows.length) previous = undefined;
  else if (head.rows[0].index_version !== CANDIDATE_INDEX_VERSION) throw new Error('CONTEXT_INDEX_VERSION_MISMATCH');
  const nodeShape = (workspace?: WorkspaceData) => workspace?.discussionNodes.map(({ id, title, summary, status }) => ({ id, title, summary, status })) ?? [];
  const nodeIds = changed(nodeShape(current), nodeShape(previous));
  const segmentIds = changed(current.segments, previous?.segments);
  const messageIds = changed(current.messages, previous?.messages);
  for (const message of [...current.messages, ...(previous?.messages ?? [])]) if (messageIds.has(message.id)) {
    nodeIds.add(message.nodeId); if (message.segmentId) segmentIds.add(message.segmentId);
  }
  for (const segment of [...current.segments, ...(previous?.segments ?? [])]) if (nodeIds.has(segment.nodeId)) segmentIds.add(segment.id);
  const attachmentIds = changed(current.attachments, previous?.attachments);
  const chunkIds = changed(current.fileChunks, previous?.fileChunks);
  for (const chunk of [...current.fileChunks, ...(previous?.fileChunks ?? [])]) if (attachmentIds.has(chunk.attachmentId)) chunkIds.add(chunk.id);
  const reference = (workspace?: WorkspaceData) => workspace?.contextItems.filter(item => !item.sourceType || item.sourceType === 'reference').map(item => ({ ...item, id: item.sourceId ?? item.id })) ?? [];
  const references = reference(current); const referenceIds = changed(references, reference(previous));
  const contributor = new LexicalContextContributor();
  let writes = 0;
  const write = async (type: ContextSource['sourceType'], id: string, value?: { title: string; content: string; nodeId?: string; attachmentId?: string }) => {
    if (!value) { await database.query('DELETE FROM context_candidate_index WHERE workspace_id=$1 AND source_type=$2 AND source_id=$3', [current.projectId, type, id]); writes += 1; return; }
    const sourceDigest = digest(value.content);
    const candidate = contributor.contribute({ ...value, workspaceId: current.projectId, sourceType: type, sourceId: id, revision: sourceDigest });
    const attachment = current.attachments.find(item => item.id === value.attachmentId);
    await database.query(`INSERT INTO context_candidate_index
      (workspace_id,source_type,source_id,source_node_id,attachment_id,source_digest,resource_version_id,resource_digest,terms,candidate)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10::jsonb)
      ON CONFLICT (workspace_id,source_type,source_id) DO UPDATE SET
      source_node_id=EXCLUDED.source_node_id,attachment_id=EXCLUDED.attachment_id,source_digest=EXCLUDED.source_digest,
      resource_version_id=EXCLUDED.resource_version_id,resource_digest=EXCLUDED.resource_digest,terms=EXCLUDED.terms,candidate=EXCLUDED.candidate`,
    [current.projectId, type, id, value.nodeId ?? null, value.attachmentId ?? null, sourceDigest, attachment?.resourceVersionId ?? null, attachment?.digest ?? null, candidate.terms, JSON.stringify(candidate)]);
    writes += 1;
  };
  for (const id of nodeIds) {
    const node = current.discussionNodes.find(item => item.id === id);
    await write('node', id, node && node.status !== 'archived' ? { title: node.title, nodeId: id, content: `${node.title}\n${node.summary}\n${current.messages.filter(item => item.nodeId === id).map(item => item.text).join('\n')}` } : undefined);
  }
  for (const id of segmentIds) {
    const segment = current.segments.find(item => item.id === id);
    const active = segment && current.discussionNodes.some(node => node.id === segment.nodeId && node.status !== 'archived');
    await write('segment', id, active ? { title: segment.title, nodeId: segment.nodeId, content: current.messages.filter(item => item.segmentId === id).map(item => item.text).join('\n') || segment.title } : undefined);
  }
  for (const id of attachmentIds) {
    const file = current.attachments.find(item => item.id === id);
    await write('file', id, file ? { title: file.name, attachmentId: id, content: file.summary || file.name } : undefined);
  }
  for (const id of chunkIds) {
    const chunk = current.fileChunks.find(item => item.id === id);
    const file = current.attachments.find(item => item.id === chunk?.attachmentId);
    await write('chunk', id, chunk && file ? { title: `${file.name} · chunk ${chunk.ordinal + 1}`, attachmentId: file.id, content: chunk.text } : undefined);
  }
  for (const id of referenceIds) { const item = references.find(item => item.id === id); await write('reference', id, item ? { title: item.title, content: item.content || item.detail } : undefined); }
  if (writes || !head.rows.length || changed(current.discussionEdges, previous?.discussionEdges).size) await database.query(`INSERT INTO context_candidate_heads(workspace_id,index_version,revision) VALUES ($1,$2,1)
    ON CONFLICT (workspace_id) DO UPDATE SET revision=context_candidate_heads.revision+1`, [current.projectId, CANDIDATE_INDEX_VERSION]);
  return { writes };
}

interface CandidateRow { source_type: string; source_id: string; source_digest: string; resource_version_id: string | null; resource_digest: string | null; candidate: PlannerCandidate }

/** Queries only indexed rows and bounded adjacency in the caller's Workspace-locked transaction. */
export async function queryContextCandidates(database: SqlQueryable, input: ContextPlanningInput): Promise<CandidateIndexSnapshot> {
  const queries: Array<{ statement: string; rowCount: number }> = [];
  const storage = database;
  database = { query: async <Row>(statement: string, values?: unknown[]) => {
    const result = await storage.query<Row>(statement, values);
    queries.push({ statement, rowCount: result.rows.length });
    return result;
  } };
  const head = await database.query<{ index_version: string; revision: string }>('SELECT index_version,revision FROM context_candidate_heads WHERE workspace_id=$1', [input.workspaceId]);
  if (!head.rows.length) throw Object.assign(new Error('Context index requires rebuild'), { code: 'CONTEXT_INDEX_NOT_READY', status: 409 });
  if (head.rows[0].index_version !== CANDIDATE_INDEX_VERSION) throw Object.assign(new Error('Context index version requires rebuild'), { code: 'CONTEXT_INDEX_VERSION_MISMATCH', status: 409 });
  const selectedKeys = input.selection.filter(item => item.status === 'active').map(itemKey);
  if (selectedKeys.length > 500) throw Object.assign(new Error('Too many explicit context sources'), { code: 'CONTEXT_SELECTION_LIMIT', status: 400 });
  const distances = new Map<string, number>([[input.nodeId, 0]]);
  let frontier = [input.nodeId];
  for (let depth = 1; depth <= 3 && frontier.length && distances.size < 500; depth += 1) {
    const edges = await database.query<{ source_node_id: string; target_node_id: string }>('SELECT source_node_id,target_node_id FROM rhiza_edges WHERE project_id=$1 AND (source_node_id=ANY($2::uuid[]) OR target_node_id=ANY($2::uuid[])) ORDER BY id LIMIT 2000', [input.workspaceId, frontier]);
    frontier = [];
    for (const edge of edges.rows) for (const id of [edge.source_node_id, edge.target_node_id]) if (!distances.has(id) && distances.size < 500) { distances.set(id, depth); frontier.push(id); }
  }
  const result = await database.query<CandidateRow>(`SELECT source_type,source_id,source_digest,resource_version_id,resource_digest,candidate
    FROM context_candidate_index WHERE workspace_id=$1 AND
    ((source_type || ':' || source_id) = ANY($2::text[]) OR source_node_id=ANY($3::text[]) OR terms && $4::text[] OR attachment_id=ANY($5::text[]))
    ORDER BY ((source_type || ':' || source_id) = ANY($2::text[])) DESC,
    (attachment_id=ANY($5::text[])) DESC NULLS LAST, (terms && $4::text[]) DESC,source_type,source_id LIMIT 500`,
  [input.workspaceId, selectedKeys, [...distances.keys()], tokenize(input.query), input.attachmentIds]);
  const candidates = result.rows.map(row => ({ ...row.candidate, graphDistance: row.candidate.item.sourceType === 'chunk' ? 2 : distances.get(row.candidate.item.sourceNodeId ?? '') ?? 8 }));
  const bySource = new Map(candidates.map(candidate => [itemKey(candidate.item), candidate]));
  const selection = input.selection.map(item => {
    if (item.status !== 'active') return item;
    const candidate = bySource.get(itemKey(item));
    if (!candidate) throw Object.assign(new Error('Explicit context source is unavailable'), { code: 'CONTEXT_SOURCE_NOT_FOUND', status: 409 });
    return { ...item, content: candidate.text, tokens: candidate.item.tokens };
  });
  const sequence = await database.query<{ sequence: string }>('SELECT COALESCE(MAX(sequence),0)::text AS sequence FROM workspace_events WHERE workspace_id=$1', [input.workspaceId]);
  return {
    version: head.rows[0].index_version, revision: String(head.rows[0].revision), graphCheckpoint: Number(sequence.rows[0].sequence), candidates, selection,
    sourceVersions: result.rows.map(row => ({ sourceType: row.source_type, sourceId: row.source_id, revision: row.source_digest, digest: row.source_digest, ...(row.resource_version_id ? { resourceVersionId: row.resource_version_id, resourceDigest: row.resource_digest! } : {}) })),
    audit: { fullWorkspaceScans: queries.filter(query => /FROM rhiza_(projects|nodes|messages|segments|attachments)\b/i.test(query.statement)).length, candidateRows: result.rows.length, neighborhoodObjects: distances.size, queries },
  };
}
