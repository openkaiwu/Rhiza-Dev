import { PGlite } from '@electric-sql/pglite';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadMigrations } from './migrate';
import { PostgresWorkspaceStore } from '../server/postgres-store';
import { createSeedWorkspace } from '../server/seed';
import { IndexedContextPlanner } from '../server/context-runtime/indexed-planner';
import type { CandidateIndexSnapshot } from '../server/context-runtime/contracts';

const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const observations = [];
for (const nodeCount of [1000, 10000]) {
  const database = new PGlite();
  try {
    for (const migration of await loadMigrations()) await database.exec(migration.sql);
    const seed = createSeedWorkspace();
    const nodes = Array.from({ length: nodeCount }, (_, index) => ({ ...seed.discussionNodes[0], id: `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`, title: `Payment evidence ${index}`, summary: 'Payment idempotency research', sourceNodeId: undefined, sourceMessageId: undefined }));
    const store = new PostgresWorkspaceStore(database);
    const started = performance.now();
    await store.initialize({ ...seed, activeNodeId: nodes[0].id, nodeId: nodes[0].id, discussionNodes: nodes, messages: [], segments: [], contextItems: [], discussionEdges: [], anchors: [], manifests: [] });
    const initializeMs = performance.now() - started;
    let snapshot!: CandidateIndexSnapshot;
    let lookupMs = 0;
    const runtime = new IndexedContextPlanner({ query: async input => { const at = performance.now(); snapshot = await store.queryContextCandidates(input); lookupMs = performance.now() - at; return snapshot; } });
    const input = { workspaceId: store.defaultWorkspaceId, nodeId: nodes[0].id, mode: 'Assisted' as const, query: 'payment evidence', selection: [], attachmentIds: [], budget: 32000 };
    const lookup: number[] = []; const plan: number[] = [];
    let fullWorkspaceScans = 0; let maxCandidateRows = 0; let maxNeighborhoodObjects = 0;
    const queryAudit = new Map<string, number>();
    for (let sample = 0; sample < 23; sample++) {
      const at = performance.now();
      const result = await runtime.plan(input);
      const elapsed = performance.now() - at;
      if (sample > 0 && result.cache.reason !== 'hit') throw new Error('Repeated unchanged planning must explain a cache hit');
      if (sample >= 3) { lookup.push(lookupMs); plan.push(elapsed); }
      fullWorkspaceScans += snapshot.audit.fullWorkspaceScans;
      maxCandidateRows = Math.max(maxCandidateRows, snapshot.audit.candidateRows);
      maxNeighborhoodObjects = Math.max(maxNeighborhoodObjects, snapshot.audit.neighborhoodObjects);
      for (const query of snapshot.audit.queries ?? []) queryAudit.set(query.statement, Math.max(queryAudit.get(query.statement) ?? 0, query.rowCount));
    }
    if (fullWorkspaceScans !== 0 || maxCandidateRows > 500 || maxNeighborhoodObjects > 500) throw new Error('M08 query boundary failed');
    const updateAt = performance.now();
    await store.update(current => ({ ...current, messages: [...current.messages, { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', nodeId: nodes[0].id, kind: 'user', text: 'new payment evidence', createdAt: seed.updatedAt }] }));
    const incrementalUpdateMs = performance.now() - updateAt;
    const invalidated = await runtime.plan(input);
    if (invalidated.cache.reason === 'hit') throw new Error('Changed source returned stale cache');
    const size = await database.query<{ bytes: number }>("SELECT pg_total_relation_size('context_candidate_index')::bigint AS bytes");
    observations.push({ nodeCount, samples: lookup.length, initializeMs, incrementalUpdateMs, indexBytes: Number(size.rows[0].bytes), lookupP50Ms: percentile(lookup, 0.5), lookupP95Ms: percentile(lookup, 0.95), planP95Ms: percentile(plan, 0.95), lookupSamplesMs: lookup, fullWorkspaceScans, maxCandidateRows, maxNeighborhoodObjects, invalidationReason: invalidated.cache.reason, lookupTarget250Ms: percentile(lookup, 0.95) <= 250 ? 'met' : 'exceeded_observational', queryAudit: [...queryAudit].map(([statement, maxRows]) => ({ statement, maxRows })) });
  } finally { await database.close(); }
}
const report = { schemaVersion: '1.0.0', commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), backend: 'PGlite', observations };
await mkdir('reports', { recursive: true });
await writeFile('reports/m08-performance.tmp', JSON.stringify(report, null, 2));
console.info(JSON.stringify(report));
