export type ContextMode = 'Auto' | 'Assisted' | 'Strict';
export type ContextStatus = 'active' | 'recommended' | 'excluded';
export type ContextRole = 'Fact' | 'Constraint' | 'Decision' | 'Reference';
export type ContextSelectionMode = 'CURRENT' | 'USER_SELECTED' | 'AI_RECOMMENDED_ACCEPTED' | 'AUTO_RETRIEVED';
export type ChatOperation = 'send' | 'retry' | 'regenerate' | 'edit-resend';

export interface GenerationOptions {
  temperature: number;
  topP: number;
  maxTokens: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface StoredAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: 'file' | 'image';
  extractedText?: string;
  summary?: string;
  chunkCount?: number;
  resourceId?: string;
  resourceVersionId?: string;
  digest?: string;
  blobRef?: string;
  createdAt: string;
}

export interface Resource {
  id: string;
  workspaceId: string;
  kind: 'attachment';
  logicalName: string;
  createdAt: string;
}

export interface ResourceVersion {
  id: string;
  resourceId: string;
  version: number;
  digestAlgorithm: 'sha256';
  digest: string;
  canonicalization: 'raw-v1';
  mediaType: string;
  size: number;
  blobRef: string;
  createdAt: string;
}

export interface ResourceMaterialization {
  id: string;
  resourceVersionId: string;
  kind: 'file-chunks';
  generator: 'legacy-context-planner-v1';
  createdAt: string;
}

export interface ContextItem {
  id: string;
  title: string;
  detail: string;
  role: ContextRole;
  status: ContextStatus;
  tokens: number;
  reason?: string;
  selectionMode?: ContextSelectionMode;
  sourceType?: 'node' | 'segment' | 'file' | 'chunk' | 'reference';
  sourceId?: string;
  sourceNodeId?: string;
  pinned?: boolean;
  contentVersion?: number;
  content?: string;
  score?: number;
}

export interface FileChunk {
  id: string;
  attachmentId: string;
  ordinal: number;
  text: string;
  startOffset: number;
  endOffset: number;
  tokens: number;
  terms: string[];
  embedding: number[];
  resourceVersionId?: string;
}

export interface StoredMessage {
  id: string;
  nodeId: string;
  kind: 'user' | 'assistant';
  text: string;
  createdAt: string;
  manifestId?: string;
  attachmentIds?: string[];
  operation?: ChatOperation;
  sourceMessageId?: string;
  versionGroupId?: string;
  version?: number;
  replyToMessageId?: string;
  usage?: TokenUsage;
  reasoning?: string;
  toolCalls?: ToolCall[];
  segmentId?: string;
}

export interface Segment {
  id: string;
  nodeId: string;
  ordinal: number;
  title: string;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  projectId: string;
  nodeId?: string;
  action: string;
  entityType: 'project' | 'node' | 'segment' | 'event' | 'workspace';
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type DiscussionStatus = 'draft' | 'active' | 'resolved' | 'stale' | 'archived';
export type EdgeRelation = 'derived-from' | 'references' | 'related-to' | 'merged-into';

export interface Anchor {
  id: string;
  nodeId: string;
  messageId?: string;
  segmentId?: string;
  selectedText?: string;
  startOffset?: number;
  endOffset?: number;
  createdAt: string;
}

export interface DiscussionNode {
  id: string;
  title: string;
  summary: string;
  status: DiscussionStatus;
  kind: 'main' | 'branch';
  sourceNodeId?: string;
  sourceMessageId?: string;
  anchorText?: string;
  x: number;
  y: number;
  createdAt: string;
  updatedAt: string;
}

export interface DiscussionEdge {
  id: string;
  source: string;
  target: string;
  relation: EdgeRelation;
  anchorId?: string;
  label: string;
  createdAt: string;
}

export interface ContextManifest {
  id: string;
  projectId: string;
  nodeId: string;
  requestId: string;
  createdAt: string;
  mode: ContextMode;
  model: string;
  provider: string;
  runtime: 'provider-adapter' | 'librechat';
  contextItemIds: string[];
  excludedItemIds: string[];
  contextItems: Array<{
    sourceType: 'node' | 'segment' | 'file' | 'chunk' | 'reference';
    sourceId: string;
    sourceNodeId?: string;
    title: string;
    detail: string;
    role: ContextRole;
    selectionMode: ContextSelectionMode;
    pinned: boolean;
    reason: string;
    tokenCount: number;
    contentVersion: number;
  }>;
  estimatedTokens: number;
  generation: GenerationOptions;
  operation: ChatOperation;
  sourceMessageId?: string;
  attachmentIds: string[];
  planner?: {
    candidateCount: number;
    selectedCount: number;
    elapsedMs: number;
    fallback: boolean;
    budget: number;
    usedTokens: number;
  };
}

export interface WorkspaceData {
  projectId: string;
  projectTitle: string;
  nodeId: string;
  mode: ContextMode;
  contextItems: ContextItem[];
  messages: StoredMessage[];
  attachments: StoredAttachment[];
  resources: Resource[];
  resourceVersions: ResourceVersion[];
  materializations: ResourceMaterialization[];
  fileChunks: FileChunk[];
  discussionNodes: DiscussionNode[];
  discussionEdges: DiscussionEdge[];
  anchors: Anchor[];
  activeNodeId: string;
  manifests: ContextManifest[];
  segments: Segment[];
  auditEvents: AuditEvent[];
  updatedAt: string;
}

export interface ProviderStatus {
  configured: boolean;
  name: string;
  model: string;
  baseUrl: string;
}
