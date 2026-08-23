import type { ContextItem, ContextManifest, FileChunk, WorkspaceData } from '../domain';

/** Context assembly seam consumed by Application without exposing host details. */
export interface ContextPlannerPort {
  plan(
    workspace: WorkspaceData,
    prompt: string,
    attachmentIds: string[],
    budget: number,
  ): { items: ContextItem[]; diagnostics: NonNullable<ContextManifest['planner']> };
  sourceItem(workspace: WorkspaceData, sourceType: 'node' | 'segment' | 'file', sourceId: string): ContextItem;
  processAttachment(
    attachmentId: string,
    name: string,
    mimeType: string,
    text: string,
  ): { chunks: FileChunk[]; summary: string };
}
