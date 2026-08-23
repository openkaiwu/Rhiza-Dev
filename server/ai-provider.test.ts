// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { OpenAiCompatibleProvider, ProviderError } from './ai-provider';
import type { AiConfig } from './config';

const config: AiConfig = {
  baseUrl: 'https://provider.example/v1', apiKey: 'secret-test-key', model: 'provider-model',
  providerName: 'Test', chatPath: '/chat/completions', timeoutMs: 1000, temperature: 0.2, extraHeaders: { 'X-Test': 'yes' },
  allowNoKey: false,
};

describe('OpenAiCompatibleProvider', () => {
  it('sends compatible messages and extracts the answer', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('provider-model');
      expect(body.messages[0].content).toContain('[Fact] 访谈');
      expect(body.messages[0].content).toContain('根系（Rhiza）');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer secret-test-key');
      return new Response(JSON.stringify({ choices: [{ message: { content: '真实回答' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const provider = new OpenAiCompatibleProvider(config, fetcher);
    const answer = await provider.complete({
      prompt: '继续分析', mode: 'Assisted', history: [],
      contextItems: [{ id: 'c1', title: '访谈', detail: '用户需要透明度', role: 'Fact', status: 'active', tokens: 100 }],
    });
    expect(answer).toBe('真实回答');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('fails clearly when no API key is configured', async () => {
    const provider = new OpenAiCompatibleProvider({ ...config, apiKey: '' });
    await expect(provider.complete({ prompt: 'test', mode: 'Strict', history: [], contextItems: [] }))
      .rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED', status: 503 } satisfies Partial<ProviderError>);
  });

  it('does not retain an upstream error response in the provider error message', async () => {
    const upstreamSecret = 'upstream-secret-token-123';
    const provider = new OpenAiCompatibleProvider(config, vi.fn(async () => new Response(JSON.stringify({ error: { message: upstreamSecret } }), { status: 401 })) as unknown as typeof fetch);
    await expect(provider.complete({ prompt: 'test', mode: 'Strict', history: [], contextItems: [] }))
      .rejects.toMatchObject({ code: 'PROVIDER_REQUEST_FAILED', message: '第三方 AI 请求失败，请稍后重试。' } satisfies Partial<ProviderError>);
    await provider.complete({ prompt: 'test', mode: 'Strict', history: [], contextItems: [] }).catch(error => expect(String(error.message)).not.toContain(upstreamSecret));
  });

  it('normalizes OpenAI-compatible SSE chunks into text deltas', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).stream).toBe(true);
      return new Response([
        'data: {"choices":[{"delta":{"content":"流式"}}]}',
        '',
        'data: {"choices":[{"delta":{"content":"回答"}}]}',
        '',
        'data: [DONE]',
        '',
      ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }) as unknown as typeof fetch;
    const provider = new OpenAiCompatibleProvider(config, fetcher);
    const deltas: string[] = [];
    for await (const event of provider.stream({ prompt: '继续分析', mode: 'Assisted', history: [], contextItems: [] })) if (event.type === 'content') deltas.push(event.delta);
    expect(deltas).toEqual(['流式', '回答']);
  });

  it('normalizes reasoning, tool calls and token usage from provider SSE', async () => {
    const fetcher = vi.fn(async () => new Response([
      'data: {"choices":[{"delta":{"reasoning_content":"检查参数"}}]}', '',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"search","arguments":"{\\"q\\":"}}]}}]}', '',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"Rhiza\\"}"}}]}}]}', '',
      'data: {"choices":[{"delta":{"content":"完成"}}],"usage":{"prompt_tokens":8,"completion_tokens":3,"total_tokens":11}}', '',
      'data: [DONE]', '',
    ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })) as unknown as typeof fetch;
    const provider = new OpenAiCompatibleProvider(config, fetcher);
    const events = [];
    for await (const event of provider.stream({ prompt: '测试', mode: 'Assisted', history: [], contextItems: [] })) events.push(event);
    expect(events).toEqual([
      { type: 'reasoning', delta: '检查参数' },
      { type: 'tool', toolCall: { id: 'tool-0', name: 'search', arguments: '{"q":' } },
      { type: 'tool', toolCall: { id: 'tool-0', name: '', arguments: '"Rhiza"}' } },
      { type: 'content', delta: '完成' },
      { type: 'usage', usage: { promptTokens: 8, completionTokens: 3, totalTokens: 11 } },
    ]);
  });
});
