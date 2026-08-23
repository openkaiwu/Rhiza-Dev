import { ProviderError } from './ai-provider';
import type { AIRuntime, ModelInfo, RuntimeRequest } from './ai-runtime';
import type { ProviderService } from './provider-service';

/**
 * Runtime adapter for the current Provider Catalog. Shared LibreChat schemas and
 * policies stay outside this execution boundary; Rhiza owns domain persistence.
 */
export class ProviderRuntime implements AIRuntime {
  readonly kind = 'provider-adapter' as const;
  constructor(private readonly providers: ProviderService) {}

  async listModels(): Promise<ModelInfo[]> {
    const catalog = await this.providers.snapshot();
    return catalog.models.map(model => ({
      id: model.id,
      provider: catalog.providers.find(provider => provider.id === model.providerId)?.name || 'Unknown',
      model: model.modelId,
      displayName: model.displayName,
      active: model.id === catalog.activeModelId,
    }));
  }

  async *generate(request: RuntimeRequest) {
    const profile = (await this.listModels()).find(model => model.id === request.modelId);
    if (!profile) {
      yield { type: 'RUN_ERROR' as const, requestId: request.requestId, code: 'MODEL_NOT_FOUND', message: 'Runtime 模型不存在。', status: 404 };
      return;
    }

    yield { type: 'RUN_START' as const, requestId: request.requestId, manifestId: request.manifestId, model: profile.model, provider: profile.provider };
    try {
      const completion = await this.providers.streamModel(request.modelId, request);
      let text = '';
      let reasoning = '';
      let usage;
      const tools = new Map<string, { id: string; name: string; arguments: string }>();
      for await (const event of completion.stream) {
        if (event.type === 'content') {
          text += event.delta;
          yield { type: 'CONTENT_DELTA' as const, requestId: request.requestId, delta: event.delta };
        } else if (event.type === 'reasoning') {
          reasoning += event.delta;
          yield { type: 'REASONING_DELTA' as const, requestId: request.requestId, delta: event.delta };
        } else if (event.type === 'tool') {
          const current = tools.get(event.toolCall.id) || { id: event.toolCall.id, name: '', arguments: '' };
          const toolCall = { id: current.id, name: current.name + event.toolCall.name, arguments: current.arguments + event.toolCall.arguments };
          tools.set(toolCall.id, toolCall);
          yield { type: 'TOOL_CALL_DELTA' as const, requestId: request.requestId, toolCall };
        } else {
          usage = event.usage;
          yield { type: 'USAGE' as const, requestId: request.requestId, usage };
        }
      }
      usage ||= {
        promptTokens: Math.ceil((request.prompt.length + request.history.reduce((sum, message) => sum + message.text.length, 0)) / 4),
        completionTokens: Math.ceil((text.length + reasoning.length) / 4),
        totalTokens: 0,
        estimated: true,
      };
      usage.totalTokens ||= usage.promptTokens + usage.completionTokens;
      yield { type: 'RUN_END' as const, requestId: request.requestId, text, model: completion.model, provider: completion.provider, reasoning: reasoning || undefined, toolCalls: tools.size ? [...tools.values()] : undefined, usage };
    } catch (error) {
      const providerError = error instanceof ProviderError ? error : new ProviderError('AI Runtime 执行失败。', 502, 'RUNTIME_ERROR', error);
      yield { type: 'RUN_ERROR' as const, requestId: request.requestId, code: providerError.code, message: providerError.message, status: providerError.status };
    }
  }
}
