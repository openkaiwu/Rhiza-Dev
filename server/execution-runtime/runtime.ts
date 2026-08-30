import type { ChatOperation, ContextItem, ContextMode, GenerationOptions, StoredAttachment, StoredMessage, TokenUsage, ToolCall } from '../domain';

/**
 * Transport-neutral runtime protocol. Application code depends on this port;
 * provider-specific streaming remains in runtime-adapters.
 */
export interface RuntimeModel {
  id: string;
  provider: string;
  model: string;
  displayName: string;
  active: boolean;
  providerEndpointRef?: string;
  endpointVersion?: string;
  endpoint?: { baseUrl: string; chatPath: string; allowNoKey: boolean };
}

export interface RuntimeRequest {
  modelSnapshot?: RuntimeModel;
  requestId: string;
  manifestId: string;
  projectId: string;
  nodeId: string;
  modelId: string;
  prompt: string;
  history: StoredMessage[];
  contextItems: ContextItem[];
  mode: ContextMode;
  attachments?: StoredAttachment[];
  generation?: GenerationOptions;
  operation?: ChatOperation;
  sourceMessageId?: string;
  signal?: AbortSignal;
}

export type RuntimeEvent =
  | { type: 'RUN_START'; requestId: string; manifestId: string; model: string; provider: string }
  | { type: 'CONTENT_DELTA'; requestId: string; delta: string }
  | { type: 'REASONING_DELTA'; requestId: string; delta: string }
  | { type: 'TOOL_CALL_DELTA'; requestId: string; toolCall: ToolCall }
  | { type: 'USAGE'; requestId: string; usage: TokenUsage }
  | { type: 'RUN_END'; requestId: string; text: string; model: string; provider: string; reasoning?: string; toolCalls?: ToolCall[]; usage?: TokenUsage }
  | { type: 'RUN_ERROR'; requestId: string; code: string; message: string; status: number };

export interface RuntimePort {
  readonly kind?: 'provider-adapter' | 'librechat';
  listModels(): Promise<RuntimeModel[]>;
  generate(request: RuntimeRequest): AsyncIterable<RuntimeEvent>;
}
