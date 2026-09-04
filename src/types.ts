export type View = 'chat' | 'graph' | 'state' | 'activity' | 'runs';
export interface WorkspaceActivityItem {
  id: string; sequence: number; type: string; title: string; detail: string; occurredAt: string; aggregateType: string; aggregateId: string;
}
export interface WorkspaceRecord { workspaceId: string; name: string; status: 'active' | 'archived'; createdBy: string; revision: number }
export type ContextMode = 'Auto' | 'Assisted' | 'Strict';
export type ContextStatus = 'active' | 'recommended' | 'excluded';
export type ChatOperation = 'send' | 'retry' | 'regenerate' | 'edit-resend';
export interface GenerationOptions { temperature: number; topP: number; maxTokens: number }
export interface TokenUsage { promptTokens: number; completionTokens: number; totalTokens: number; estimated?: boolean }
export interface ToolCall { id: string; name: string; arguments: string }
export interface Attachment { id: string; name: string; mimeType: string; size: number; kind: 'file' | 'image'; summary?: string; chunkCount?: number; createdAt: string }

export interface ContextItem {
  id: string;
  title: string;
  detail: string;
  role: 'Fact' | 'Constraint' | 'Decision' | 'Reference';
  status: ContextStatus;
  tokens: number;
  reason?: string;
  selectionMode?: 'CURRENT' | 'USER_SELECTED' | 'AI_RECOMMENDED_ACCEPTED' | 'AUTO_RETRIEVED';
  sourceType?: 'node' | 'segment' | 'file' | 'chunk' | 'reference';
  sourceId?: string;
  sourceNodeId?: string;
  pinned?: boolean;
  contentVersion?: number;
  content?: string;
  score?: number;
}

export interface Segment { id: string; nodeId: string; ordinal: number; title: string; createdAt: string }
export interface ManifestContextItem {
  sourceType: 'node' | 'segment' | 'file' | 'chunk' | 'reference'; sourceId: string; sourceNodeId?: string;
  title: string; detail: string; role: ContextItem['role'];
  selectionMode: NonNullable<ContextItem['selectionMode']>; pinned: boolean; reason: string;
  tokenCount: number; contentVersion: number;
}
export interface ContextManifest {
  id: string; projectId: string; nodeId: string; requestId: string; createdAt: string;
  mode: ContextMode; contextItemIds: string[]; excludedItemIds: string[];
  contextItems: ManifestContextItem[]; model: string; provider: string;
  runtime: 'provider-adapter' | 'librechat'; estimatedTokens: number; generation: GenerationOptions;
  operation: ChatOperation; sourceMessageId?: string; attachmentIds: string[];
  planner?: { candidateCount: number; selectedCount: number; elapsedMs: number; fallback: boolean; budget: number; usedTokens: number };
}

export interface Message {
  id: string;
  nodeId: string;
  kind: 'user' | 'assistant';
  text: string;
  createdAt: string;
  manifestId?: string;
  pending?: boolean;
  attachmentIds?: string[];
  operation?: ChatOperation;
  sourceMessageId?: string;
  versionGroupId?: string;
  version?: number;
  replyToMessageId?: string;
  usage?: TokenUsage;
  reasoning?: string;
  toolCalls?: ToolCall[];
}

export interface TemporaryBranch {
  id: string;
  sourceNodeId: string;
  sourceMessageId: string;
  anchorText: string;
  anchorStart?: number;
  anchorEnd?: number;
  title: string;
  messages: Message[];
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

export interface ProviderStatus {
  configured: boolean;
  name: string;
  model: string;
  baseUrl: string;
}

export type ProviderPreset = 'openai' | 'openrouter' | 'deepseek' | 'siliconflow' | 'ollama' | 'custom';
export interface SafeProvider {
  id: string; preset: ProviderPreset; name: string; baseUrl: string; chatPath: string;
  allowNoKey: boolean; hasApiKey: boolean; configured: boolean; createdAt: string; updatedAt: string;
}
export interface ModelRecord {
  id: string; providerId: string; modelId: string; displayName: string;
  favorite: boolean; pinned: boolean; createdAt: string;
}
export interface ProviderCatalog {
  providers: SafeProvider[];
  models: ModelRecord[];
  activeModelId: string | null;
  modelSpecs?: Array<{
    name: string; label: string; group?: string; description?: string;
    preset: { endpoint?: string | null; endpointType?: string | null; model?: string | null };
  }>;
  filePolicy?: {
    disabled: boolean; maxFiles: number; maxFileSizeBytes: number; maxTotalSizeBytes: number;
    fileTokenLimit: number; supportedMimeTypes: string[];
  };
}
export interface ProviderPresetInfo { name: string; baseUrl: string; allowNoKey: boolean }

export interface WorkspaceSnapshot {
  projectId: string;
  nodeId: string;
  mode: ContextMode;
  contextItems: ContextItem[];
  messages: Message[];
  attachments: Attachment[];
  discussionNodes: DiscussionNode[];
  discussionEdges: DiscussionEdge[];
  anchors: Anchor[];
  activeNodeId: string;
  manifests: ContextManifest[];
  segments: Segment[];
  fileChunks?: unknown[];
  updatedAt: string;
}

export interface ExecutionRun {
  id: string; workspaceId: string; nodeId: string; status: string; attempt: number;
  parentRunRef?: string; inputHash: string; createdAt: string; terminalAt?: string;
  input: { executor: { runtime: string; modelSpecRef: string; providerEndpointRef: string; model: string; provider: string }; request: { prompt: string; manifestId: string; attachments?: Array<{ id: string }>; generation?: GenerationOptions; operation?: ChatOperation } };
  error?: { code: string; class: string; message: string };
  telemetry: { durationMs?: number; ttftMs?: number; traceCount: number; usage?: TokenUsage };
}

export interface GraphObjectRef { workspaceId: string; objectType: string; objectId: string; versionId?: string }
export interface GraphProjectedObject {
  ref: GraphObjectRef; revision: number; lifecycle: 'active' | 'archived' | 'tombstoned';
  title: string; summary: string; kind: string; status: string; createdAt: string; updatedAt: string;
  layout?: { x: number; y: number; collapsed?: boolean };
}
export interface GraphProjectedRelation {
  id: string; source: GraphObjectRef; target: GraphObjectRef; relationType: string;
  lifecycle: 'active' | 'retracted'; label: string; createdAt: string;
}
export interface GraphProjectionResult {
  version: string; checkpoint: number; objects: GraphProjectedObject[]; relations: GraphProjectedRelation[]; nextCursor?: string;
}
