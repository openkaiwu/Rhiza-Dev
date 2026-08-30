import type { ChatOperation, ContextItem, ContextMode, GenerationOptions, StoredAttachment, StoredMessage, TokenUsage, ToolCall } from './domain';

export interface ModelInfo {
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
  modelSnapshot?: ModelInfo;
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

export interface AIRuntime {
  readonly kind?: 'provider-adapter' | 'librechat';
  listModels(): Promise<ModelInfo[]>;
  generate(request: RuntimeRequest): AsyncIterable<RuntimeEvent>;
}

export interface RuntimeResult {
  text: string;
  model: string;
  provider: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
  usage: TokenUsage;
}

export class RuntimeExecutionError extends Error {
  constructor(message: string, readonly status = 502, readonly code = 'RUNTIME_ERROR') {
    super(message);
  }
}

/** Collects the event protocol for today's request/response API; SSE can consume the same stream later. */
export async function collectRuntimeResult(runtime: AIRuntime, request: RuntimeRequest): Promise<RuntimeResult> {
  let result: RuntimeResult | undefined;
  for await (const event of runtime.generate(request)) {
    if (event.type === 'RUN_END') result = { text: event.text, model: event.model, provider: event.provider, reasoning: event.reasoning, toolCalls: event.toolCalls, usage: event.usage || { promptTokens: 0, completionTokens: Math.ceil(event.text.length / 4), totalTokens: Math.ceil(event.text.length / 4), estimated: true } };
    if (event.type === 'RUN_ERROR') {
      throw new RuntimeExecutionError(event.message, event.status, event.code);
    }
  }
  if (!result) throw new RuntimeExecutionError('AI Runtime 未返回 RUN_END 事件。', 502, 'INCOMPLETE_RUNTIME_STREAM');
  return result;
}
