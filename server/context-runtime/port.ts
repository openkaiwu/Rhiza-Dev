import type { ContextItem, FileChunk, WorkspaceData } from '../domain';
export { activeContextSelection, estimateTokens } from '../context-planner';

/** Context assembly seam consumed by Application without exposing host details. */
export interface ContextPlannerPort {
  plan(
    workspace: WorkspaceData,
    prompt: string,
    attachmentIds: string[],
    budget: number,
  ): import('../context-planner').PlannerResult;
  sourceItem(workspace: WorkspaceData, sourceType: 'node' | 'segment' | 'file', sourceId: string): ContextItem;
  processAttachment(
    attachmentId: string,
    name: string,
    mimeType: string,
    text: string,
  ): { chunks: FileChunk[]; summary: string };
}
