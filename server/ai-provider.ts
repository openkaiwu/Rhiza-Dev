import type { AiConfig } from './config';
import type { ContextItem, GenerationOptions, StoredAttachment, StoredMessage, TokenUsage, ToolCall } from './domain';
import { buildLibreChatAgentMessages } from './librechat-shared';

export class ProviderError extends Error {
  constructor(message: string, readonly status = 502, readonly code = 'PROVIDER_ERROR', cause?: unknown) {
    super(message, { cause });
  }
}

interface CompletionRequest {
  prompt: string;
  history: StoredMessage[];
  contextItems: ContextItem[];
  mode: string;
  attachments?: StoredAttachment[];
  generation?: GenerationOptions;
  signal?: AbortSignal;
}

export type ProviderStreamEvent =
  | { type: 'content'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool'; toolCall: ToolCall }
  | { type: 'usage'; usage: TokenUsage };

function completionPayload(config: AiConfig, request: CompletionRequest, stream = false) {
  return {
    model: config.model,
    temperature: request.generation?.temperature ?? config.temperature,
    ...(request.generation ? { top_p: request.generation.topP, max_tokens: request.generation.maxTokens } : {}),
    ...(stream ? { stream: true } : {}),
    messages: buildLibreChatAgentMessages(request),
  };
}

function extractText(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const data = payload as { choices?: Array<{ message?: { content?: unknown } }>; output_text?: unknown };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    const text = content.map(part => {
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') return part.text;
      return '';
    }).join('').trim();
    if (text) return text;
  }
  return typeof data.output_text === 'string' ? data.output_text.trim() : undefined;
}

function textDelta(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(part => part && typeof part === 'object' && 'text' in part && typeof part.text === 'string' ? part.text : '').join('');
}

function parseSseFrame(frame: string): ProviderStreamEvent[] {
  const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
  if (!data || data === '[DONE]') return [];
  try {
    const payload = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const delta = payload.choices?.[0]?.delta;
    const events: ProviderStreamEvent[] = [];
    const content = textDelta(delta?.content);
    const reasoning = textDelta(delta?.reasoning_content ?? delta?.reasoning);
    if (content) events.push({ type: 'content', delta: content });
    if (reasoning) events.push({ type: 'reasoning', delta: reasoning });
    for (const tool of delta?.tool_calls || []) {
      events.push({ type: 'tool', toolCall: { id: `tool-${tool.index ?? 0}`, name: tool.function?.name || '', arguments: tool.function?.arguments || '' } });
    }
    if (payload.usage) {
      events.push({ type: 'usage', usage: {
        promptTokens: payload.usage.prompt_tokens || 0,
        completionTokens: payload.usage.completion_tokens || 0,
        totalTokens: payload.usage.total_tokens || (payload.usage.prompt_tokens || 0) + (payload.usage.completion_tokens || 0),
      } });
    }
    return events;
  } catch { return []; }
}

export class OpenAiCompatibleProvider {
  constructor(private readonly config: AiConfig, private readonly fetcher: typeof fetch = fetch) {
    if (!/^https?:\/\//.test(config.baseUrl)) throw new Error('AI_BASE_URL must use http or https');
  }

  get status() {
    const safeUrl = new URL(this.config.baseUrl);
    safeUrl.username = '';
    safeUrl.password = '';
    safeUrl.search = '';
    safeUrl.hash = '';
    return {
      configured: Boolean(this.config.apiKey) || this.config.allowNoKey,
      name: this.config.providerName,
      model: this.config.model,
      baseUrl: safeUrl.toString().replace(/\/$/, ''),
    };
  }

  async complete(request: CompletionRequest): Promise<string> {
    if (!this.config.apiKey && !this.config.allowNoKey) {
      throw new ProviderError('尚未配置第三方 AI。请在 .env 中设置 AI_API_KEY、AI_BASE_URL 和 AI_MODEL。', 503, 'PROVIDER_NOT_CONFIGURED');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetcher(`${this.config.baseUrl}${this.config.chatPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
          ...this.config.extraHeaders,
        },
        body: JSON.stringify(completionPayload(this.config, request)),
        signal: request.signal ? AbortSignal.any([controller.signal, request.signal]) : controller.signal,
      });

      const raw = await response.text();
      let payload: unknown;
      try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
      if (!response.ok) {
        throw new ProviderError('第三方 AI 请求失败，请稍后重试。', 502, 'PROVIDER_REQUEST_FAILED', raw);
      }

      const text = extractText(payload);
      if (!text) throw new ProviderError('第三方 AI 返回了无法识别的空响应。', 502, 'INVALID_PROVIDER_RESPONSE');
      return text;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof Error && error.name === 'AbortError' && request.signal?.aborted) throw new ProviderError('生成已停止。', 499, 'GENERATION_STOPPED');
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ProviderError('第三方 AI 请求超时，请检查网络或调高 AI_TIMEOUT_MS。', 504, 'PROVIDER_TIMEOUT');
      }
      throw new ProviderError('无法连接第三方 AI，请检查网络或供应商配置。', 502, 'PROVIDER_UNREACHABLE', error);
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Normalizes OpenAI-compatible SSE without exposing provider wire events. */
  async *stream(request: CompletionRequest): AsyncIterable<ProviderStreamEvent> {
    if (!this.config.apiKey && !this.config.allowNoKey) {
      throw new ProviderError('尚未配置第三方 AI。请在模型设置中配置供应商和模型。', 503, 'PROVIDER_NOT_CONFIGURED');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetcher(`${this.config.baseUrl}${this.config.chatPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
          ...this.config.extraHeaders,
        },
        body: JSON.stringify(completionPayload(this.config, request, true)),
        signal: request.signal ? AbortSignal.any([controller.signal, request.signal]) : controller.signal,
      });

      if (!response.ok) {
        const raw = await response.text();
        throw new ProviderError('第三方 AI 请求失败，请稍后重试。', 502, 'PROVIDER_REQUEST_FAILED', raw);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/event-stream')) {
        const text = extractText(await response.json().catch(() => ({})));
        if (!text) throw new ProviderError('第三方 AI 返回了无法识别的空响应。', 502, 'INVALID_PROVIDER_RESPONSE');
        yield { type: 'content', delta: text };
        return;
      }

      if (!response.body) throw new ProviderError('第三方 AI 未返回可读取的事件流。', 502, 'INVALID_PROVIDER_RESPONSE');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let emitted = false;
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || '';
        for (const frame of frames) for (const event of parseSseFrame(frame)) { emitted = true; yield event; }
        if (done) break;
      }
      for (const event of parseSseFrame(buffer)) { emitted = true; yield event; }
      if (!emitted) throw new ProviderError('第三方 AI 事件流未包含文本内容。', 502, 'INVALID_PROVIDER_RESPONSE');
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof Error && error.name === 'AbortError' && request.signal?.aborted) throw new ProviderError('生成已停止。', 499, 'GENERATION_STOPPED');
      if (error instanceof Error && error.name === 'AbortError') throw new ProviderError('第三方 AI 请求超时，请检查网络或调高 AI_TIMEOUT_MS。', 504, 'PROVIDER_TIMEOUT');
      throw new ProviderError('无法连接第三方 AI，请检查网络或供应商配置。', 502, 'PROVIDER_UNREACHABLE', error);
    } finally {
      clearTimeout(timeout);
    }
  }
}
