import type { ContextItem, ContextMode, ResourceVersion } from '../domain';
import type { PlannerCandidate, PlannerResult } from '../context-planner';

export interface ContextPlanningInput {
  workspaceId: string;
  nodeId: string;
  mode: ContextMode;
  query: string;
  selection: ContextItem[];
  attachmentIds: string[];
  budget: number;
}

/** A contributor sees only the changed source, never the Workspace aggregate. */
export interface ContextSource {
  workspaceId: string;
  sourceType: NonNullable<ContextItem['sourceType']>;
  sourceId: string;
  nodeId?: string;
  attachmentId?: string;
  title: string;
  content: string;
  revision: string;
}

export interface ContextContributor {
  readonly version: string;
  contribute(source: ContextSource): PlannerCandidate;
}

export interface CandidateIndexSnapshot {
  version: string;
  revision: string;
  graphCheckpoint: number;
  candidates: PlannerCandidate[];
  /** Index resolves explicit sources too; absence is an error, not stale UI content. */
  selection: ContextItem[];
  sourceVersions: Array<{ sourceType: string; sourceId: string; revision: string; resourceVersionId: string; digest: string }>;
  audit: { fullWorkspaceScans: number; candidateRows: number; neighborhoodObjects: number };
}

export interface CandidateIndex {
  query(input: ContextPlanningInput): Promise<CandidateIndexSnapshot>;
}

export interface ContextPlanner {
  readonly version: string;
  plan(input: ContextPlanningInput, snapshot: CandidateIndexSnapshot): PlannerResult;
}

export interface FrozenContextItem {
  item: ContextItem;
  resourceVersion: ResourceVersion;
  priority: number;
  contributorVersion: string;
}

/** Implementations must persist and verify immutable bytes before returning their reference. */
export interface ContextCompiler {
  readonly version: string;
  compile(workspaceId: string, items: readonly ContextItem[]): Promise<FrozenContextItem[]>;
}

export interface ContextVersionVector {
  contributors: Record<string, string>;
  planner: string;
  compiler: string;
  tokenizer: string;
  selectionPolicy: string;
}

export type HistoricalSourceResolution =
  | { status: 'resolved'; resourceVersion: ResourceVersion; content: string }
  | { status: 'missing_resource' | 'missing_version' | 'missing_blob' | 'digest_mismatch' | 'legacy_unversioned'; sourceId: string };
