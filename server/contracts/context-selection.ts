export interface ContextSourceRef { sourceType: 'node' | 'segment'; sourceId: string }
export interface ReviewedContextSource extends ContextSourceRef { sourceRevision: string; title: string; tokens: number }
export interface ContextSelectionPreview {
  workspaceId: string;
  expectedNodeId: string;
  sources: ReviewedContextSource[];
  budget: number;
  usedTokens: number;
  overBudget: boolean;
  status: 'ready' | 'over_budget';
}
export interface ConfirmContextSelection {
  expectedNodeId: string;
  sources: Array<ContextSourceRef & { sourceRevision: string }>;
}
