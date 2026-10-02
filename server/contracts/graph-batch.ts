import type { WorkspaceData } from '../domain';
import type { CommandMap } from './application';

export interface GraphNodeVersion { status: WorkspaceData['discussionNodes'][number]['status']; updatedAt: string }
export type GraphBatchItem = { itemId: string } & (
  | { commandType: 'ArchiveObject'; payload: { nodeId: string } }
  | { commandType: 'CreateRelation'; payload: { source: string; target: string; relation: WorkspaceData['discussionEdges'][number]['relation']; label?: string } }
);
export type GraphBatchRequest = { kind: 'apply'; items: GraphBatchItem[] } | { kind: 'undo'; batchId: string; itemIds?: string[] };
type StepType = 'ArchiveObject' | 'ChangeNodeStatus' | 'CreateRelation' | 'RemoveRelation';
export type GraphBatchStep = { commandId: string; afterPrevious?: boolean } & {
  [K in StepType]: { commandType: K; payload: CommandMap[K]['payload'] }
}[StepType];
export interface GraphBatchPlannedItem {
  itemId: string;
  steps: GraphBatchStep[];
  previousStatus?: GraphNodeVersion['status'];
  error?: { code: string; status: number };
  skipped?: 'ALREADY_ARCHIVED' | 'NOT_COMMITTED';
}
/** Frozen operation metadata stored only in an encrypted, scoped receipt, outside portable facts. */
export interface GraphBatchPlan { kind: 'graph-batch-plan-v1'; batchId: string; workspaceId: string; ownerId: string; request: GraphBatchRequest; items: GraphBatchPlannedItem[] }
export interface GraphBatchStepOutcome { commandId: string; status: 'succeeded' | 'failed' | 'pending' | 'blocked'; code?: string; retryable?: boolean }
export interface GraphBatchOutcome { itemId: string; status: 'succeeded' | 'failed' | 'partial' | 'pending' | 'skipped'; code?: string; undoable: boolean; steps: GraphBatchStepOutcome[] }
export interface GraphBatchResult { batchId: string; workspaceId: string; status: 'completed' | 'partial' | 'failed' | 'incomplete'; outcomes: GraphBatchOutcome[] }
export const graphBatchChildId = (batchId: string, itemId: string, step: number) => `${batchId}:graph-item:${itemId}:${step}`;
