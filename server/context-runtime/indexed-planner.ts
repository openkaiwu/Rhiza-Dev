import { planCandidates, type PlannerResult } from '../context-planner';
import { semanticStateChecksum } from '../infrastructure/workspace-semantic-checksum';
import type { CandidateIndex, CandidateIndexSnapshot, ContextPlanner, ContextPlanningInput, ContextVersionVector } from './contracts';

export const CONTEXT_VERSIONS: ContextVersionVector = {
  contributors: { lexical: 'lexical-v1' }, planner: 'deterministic-v1', compiler: 'frozen-resource-v1',
  tokenizer: 'nfkc-cjk-bigram-v1', selectionPolicy: 'explicit-first-v1',
};

export class DeterministicContextPlanner implements ContextPlanner {
  readonly version = CONTEXT_VERSIONS.planner;
  plan(input: ContextPlanningInput, snapshot: CandidateIndexSnapshot): PlannerResult {
    return planCandidates({ ...input, selection: snapshot.selection }, snapshot.candidates);
  }
}

export function contextCacheIdentity(input: ContextPlanningInput, snapshot: CandidateIndexSnapshot, versions: ContextVersionVector) {
  const vector = {
    input: semanticStateChecksum({ ...input, resolvedSelection: snapshot.selection }),
    sources: semanticStateChecksum({ versions: [...snapshot.sourceVersions].sort((a, b) => a.sourceType.localeCompare(b.sourceType) || a.sourceId.localeCompare(b.sourceId)) }),
    index: semanticStateChecksum({ version: snapshot.version, revision: snapshot.revision, graphCheckpoint: snapshot.graphCheckpoint }),
    runtime: semanticStateChecksum({ ...versions }),
  };
  return { key: semanticStateChecksum(vector), vector };
}

export type ContextCacheReason = 'hit' | 'cold' | 'input_changed' | 'sources_changed' | 'index_changed' | 'runtime_changed';

/** One retained plan bounds memory; each attempt still checks authoritative index revisions. */
export class IndexedContextPlanner {
  private cached?: { identity: ReturnType<typeof contextCacheIdentity>; plan: PlannerResult };
  constructor(private readonly index: CandidateIndex, private readonly planner: ContextPlanner = new DeterministicContextPlanner(), private readonly versions: ContextVersionVector = CONTEXT_VERSIONS) {}

  async plan(input: ContextPlanningInput) {
    const snapshot = await this.index.query(input);
    if (snapshot.audit.fullWorkspaceScans !== 0 || snapshot.candidates.length > 500 || snapshot.audit.neighborhoodObjects > 500) throw new Error('CONTEXT_QUERY_BOUNDARY_VIOLATION');
    const identity = contextCacheIdentity(input, snapshot, { ...this.versions, planner: this.planner.version });
    let reason: ContextCacheReason = 'cold';
    if (this.cached) {
      reason = 'hit';
      for (const component of ['runtime', 'input', 'sources', 'index'] as const) {
        if (this.cached.identity.vector[component] !== identity.vector[component]) { reason = `${component}_changed`; break; }
      }
    }
    const plan = reason === 'hit' ? structuredClone(this.cached!.plan) : this.planner.plan(input, snapshot);
    this.cached = { identity, plan: structuredClone(plan) };
    return { ...plan, cache: { ...identity, reason }, audit: snapshot.audit, sourceVersions: snapshot.sourceVersions };
  }
}
