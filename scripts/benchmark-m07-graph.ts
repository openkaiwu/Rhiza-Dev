import { performance } from 'node:perf_hooks';
import { graphNeighborhood, type ProjectedObject, type ProjectedRelation } from '../server/graph-projection/model';

const workspaceId = 'm07-benchmark';
const createdAt = '2026-09-05T00:00:00.000Z';
const objects: ProjectedObject[] = Array.from({ length: 10_000 }, (_, index) => ({
  ref: { workspaceId, objectType: 'conversation', objectId: `node-${index}` }, revision: 1, lifecycle: 'active',
  title: `Node ${index}`, summary: '', kind: index === 0 ? 'main' : 'branch', status: 'active', createdAt, updatedAt: createdAt,
}));
const relations: ProjectedRelation[] = Array.from({ length: 50_000 }, (_, index) => ({
  id: `relation-${index}`, source: objects[index % objects.length]!.ref, target: objects[(index * 37 + 1) % objects.length]!.ref,
  relationType: 'related_to', lifecycle: 'active', label: '', createdAt,
}));
const projection = { workspaceId, version: 'graph-v1' as const, checkpoint: 1, checksum: 'benchmark', objects, relations };
const samples = Array.from({ length: 20 }, () => {
  const started = performance.now();
  const result = graphNeighborhood(projection, { root: objects[0]!.ref, depth: 3, nodeLimit: 500, edgeLimit: 2_000 });
  if (result.objects.length > 500 || result.relations.length > 2_000) throw new Error('bounded graph query exceeded its hard cap');
  return performance.now() - started;
}).sort((left, right) => left - right);
const p95Ms = samples[Math.ceil(samples.length * 0.95) - 1]!;
console.info(JSON.stringify({ objects: objects.length, relations: relations.length, samples: samples.length, p95Ms }));
if (p95Ms >= 300) throw new Error(`M07 bounded graph p95 ${p95Ms.toFixed(2)}ms exceeds 300ms`);
