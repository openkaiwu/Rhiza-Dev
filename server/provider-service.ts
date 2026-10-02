import { randomUUID } from 'node:crypto';
import { OpenAiCompatibleProvider, ProviderError } from './ai-provider';
import type { AiConfig } from './config';
import type { ContextItem, StoredMessage } from './domain';
import { libreChatEndpointForPreset, libreChatFilePolicy, toLibreChatModelSpec } from './librechat-shared';
import type { DiscoveryCode, ModelRecord, ProviderCatalogQuery, ProviderDiscoveryBatchInput, ProviderDiscoveryBatchResult, ProviderDiscoveryHealth, ProviderPreset, ProviderSnapshot, StoredProvider } from './provider-domain';
import { providerDiscoveryFailures } from './provider-domain';
import type { ProviderStore } from './provider-store';
import type { SecretVault } from './secret-vault';

export const providerPresets: Record<Exclude<ProviderPreset, 'custom'>, { name: string; baseUrl: string; allowNoKey: boolean }> = {
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', allowNoKey: false },
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', allowNoKey: false },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', allowNoKey: false },
  siliconflow: { name: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', allowNoKey: false },
  ollama: { name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', allowNoKey: true },
};

interface CompletionRequest { modelSnapshot?: import('./execution-runtime/runtime').RuntimeModel; prompt: string; history: StoredMessage[]; contextItems: ContextItem[]; mode: string; attachments?: import('./domain').StoredAttachment[]; generation?: import('./domain').GenerationOptions; signal?: AbortSignal }
interface ProviderInput { preset: ProviderPreset; name: string; baseUrl: string; apiKey?: string; allowNoKey: boolean; modelId?: string; displayName?: string }

function discoveryError(code: Exclude<DiscoveryCode, 'MODEL_DISCOVERY_OK'>): ProviderError {
  const failure = providerDiscoveryFailures[code];
  return new ProviderError(failure.message, failure.status, code);
}

export class ProviderService {
  private seeded = false;
  private readonly discoveries = new Map<string, Promise<ProviderSnapshot>>();
  constructor(private readonly store: ProviderStore, private readonly vault: SecretVault, private readonly envConfig: AiConfig, private readonly fetcher: typeof fetch = fetch) {}

  async snapshot(query: ProviderCatalogQuery = {}): Promise<ProviderSnapshot> {
    if (!query || typeof query !== 'object'
      || (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 200))
      || (query.providerId !== undefined && (typeof query.providerId !== 'string' || query.providerId.length > 200))
      || (query.favorite !== undefined && typeof query.favorite !== 'boolean')
      || (query.pinned !== undefined && typeof query.pinned !== 'boolean')
      || (query.sort !== undefined && !['preferred', 'name', 'provider'].includes(query.sort))) {
      throw new ProviderError('模型目录筛选条件无效。', 400, 'INVALID_CATALOG_QUERY');
    }
    const data = await this.ensureSeed();
    const providers = data.providers.map(({ apiKey, ...provider }) => ({ ...provider,
      discoveryHealth: provider.discoveryHealth?.endpointVersion === provider.updatedAt ? provider.discoveryHealth : { status: 'unknown' as const, endpointVersion: provider.updatedAt },
      hasApiKey: Boolean(apiKey), configured: Boolean(apiKey) || provider.allowNoKey }));
    const search = query.search?.trim().toLocaleLowerCase();
    const providerNames = new Map(providers.map(provider => [provider.id, provider.name]));
    const models = data.models.filter(model => (!query.providerId || model.providerId === query.providerId)
      && (query.favorite === undefined || model.favorite === query.favorite)
      && (query.pinned === undefined || model.pinned === query.pinned)
      && (!search || `${model.displayName} ${model.modelId} ${providerNames.get(model.providerId) ?? ''}`.toLocaleLowerCase().includes(search)))
      .sort((a, b) => (query.sort === 'provider' ? (providerNames.get(a.providerId) ?? '').localeCompare(providerNames.get(b.providerId) ?? '')
        : query.sort === 'name' ? 0 : Number(b.pinned) - Number(a.pinned) || Number(b.favorite) - Number(a.favorite))
        || a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
    const activeModel = data.models.find(model => model.id === data.activeModelId);
    const activeProvider = data.providers.find(provider => provider.id === activeModel?.providerId);
    return {
      providers,
      models,
      activeModelId: data.activeModelId,
      modelSpecs: models.flatMap(model => {
        const provider = data.providers.find(item => item.id === model.providerId);
        return provider ? [toLibreChatModelSpec(provider, model)] : [];
      }),
      filePolicy: libreChatFilePolicy(activeProvider ? libreChatEndpointForPreset(activeProvider.preset) : undefined),
    };
  }

  async activeStatus() {
    const snapshot = await this.snapshot();
    const model = snapshot.models.find(item => item.id === snapshot.activeModelId);
    const provider = snapshot.providers.find(item => item.id === model?.providerId);
    return { configured: Boolean(provider?.configured && model), name: provider?.name || '未配置供应商', model: model?.displayName || '未选择模型', baseUrl: provider?.baseUrl || '' };
  }

  async saveProvider(input: ProviderInput, providerId?: string): Promise<ProviderSnapshot> {
    this.validateProvider(input);
    const now = new Date().toISOString();
    const id = providerId || randomUUID();
    await this.store.update(async data => {
      const previous = data.providers.find(provider => provider.id === id);
      if (providerId && !previous) throw new ProviderError('供应商不存在。', 404, 'PROVIDER_NOT_FOUND');
      const apiKey = input.apiKey?.trim() ? await this.vault.encrypt(input.apiKey.trim()) : previous?.apiKey;
      const updatedAt = new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
      const provider: StoredProvider = { id, preset: input.preset, name: input.name.trim(), baseUrl: input.baseUrl.replace(/\/$/, ''), chatPath: '/chat/completions', allowNoKey: input.allowNoKey, apiKey, createdAt: previous?.createdAt || now, updatedAt };
      data.providers = previous ? data.providers.map(item => item.id === id ? provider : item) : [...data.providers, provider];
      if (input.modelId?.trim()) {
        const modelId = input.modelId.trim();
        const existing = data.models.find(model => model.providerId === id && model.modelId === modelId);
        if (!existing) {
          const model: ModelRecord = { id: randomUUID(), providerId: id, modelId, displayName: input.displayName?.trim() || modelId, favorite: false, pinned: false, createdAt: now };
          data.models.push(model);
          data.activeModelId ??= model.id;
        }
      }
      return data;
    });
    return this.snapshot();
  }

  async discoverModels(providerId: string): Promise<ProviderSnapshot> {
    const data = await this.ensureSeed();
    const provider = data.providers.find(item => item.id === providerId);
    if (!provider) throw new ProviderError('供应商不存在。', 404, 'PROVIDER_NOT_FOUND');
    const key = `${provider.id}:${provider.updatedAt}`;
    const pending = this.discoveries.get(key);
    if (pending) return pending;
    const operation = this.refreshCatalog(provider);
    this.discoveries.set(key, operation);
    try { return await operation; } finally { this.discoveries.delete(key); }
  }

  private async refreshCatalog(provider: StoredProvider): Promise<ProviderSnapshot> {
    const apiKey = await this.vault.decrypt(provider.apiKey);
    let failure: ProviderError | undefined;
    let discovered: Array<{ id: string; name?: string }> = [];
    try {
      if (!apiKey && !provider.allowNoKey) throw discoveryError('PROVIDER_NOT_CONFIGURED');
      discovered = await this.fetchCatalog(provider, apiKey);
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      failure = error;
    }
    const health: ProviderDiscoveryHealth = {
      status: failure?.code === 'PROVIDER_INVALID_KEY' ? 'invalid-key' : failure?.code === 'PROVIDER_NOT_CONFIGURED' ? 'unconfigured' : failure ? 'degraded' : 'healthy',
      code: (failure?.code ?? 'MODEL_DISCOVERY_OK') as DiscoveryCode,
      endpointVersion: provider.updatedAt, checkedAt: new Date().toISOString(),
      ...(!failure ? { discoveredCount: discovered.length } : {}),
    };
    await this.store.update(current => {
      const target = current.providers.find(item => item.id === provider.id);
      if (!target || target.updatedAt !== provider.updatedAt) throw new ProviderError('供应商配置已变化，请重新刷新。', 409, 'PROVIDER_CONFIGURATION_CHANGED');
      target.discoveryHealth = health;
      for (const item of discovered) {
        if (current.models.some(model => model.providerId === provider.id && model.modelId === item.id)) continue;
        current.models.push({ id: randomUUID(), providerId: provider.id, modelId: item.id, displayName: item.name || item.id, favorite: false, pinned: false, createdAt: new Date().toISOString() });
      }
      if (!failure) current.activeModelId ??= current.models.find(model => model.providerId === provider.id)?.id || null;
      return current;
    });
    if (failure) throw failure;
    return this.snapshot();
  }

  private async fetchCatalog(provider: StoredProvider, apiKey: string): Promise<Array<{ id: string; name?: string }>> {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer!: ReturnType<typeof setTimeout>;
    const timeoutMs = Math.min(10_000, Math.max(1, Number.isFinite(this.envConfig.timeoutMs) ? this.envConfig.timeoutMs : 10_000));
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(discoveryError('MODEL_DISCOVERY_TIMEOUT')); controller.abort(); }, timeoutMs);
    });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await this.fetcher(`${provider.baseUrl}/models`, { signal: controller.signal, redirect: 'error', headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) } });
        if (!response.ok) throw discoveryError(response.status === 401 || response.status === 403 ? 'PROVIDER_INVALID_KEY'
          : response.status === 404 || response.status === 405 ? 'MODEL_DISCOVERY_UNSUPPORTED'
          : response.status === 429 ? 'MODEL_DISCOVERY_RATE_LIMITED' : 'MODEL_DISCOVERY_FAILED');
        // Bound both body consumption and parsing; never retain response bodies in health/errors.
        reader = response.body?.getReader();
        if (!reader) throw discoveryError('MODEL_DISCOVERY_INVALID_RESPONSE');
        const decoder = new TextDecoder();
        let text = '', bytes = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > 2 * 1024 * 1024) throw discoveryError('MODEL_DISCOVERY_INVALID_RESPONSE');
            text += decoder.decode(chunk.value, { stream: true });
          }
          text += decoder.decode();
        } finally { void reader.cancel().catch(() => undefined); }
        let payload: unknown;
        try { payload = JSON.parse(text); } catch { throw discoveryError('MODEL_DISCOVERY_INVALID_RESPONSE'); }
        if (!payload || typeof payload !== 'object' || !('data' in payload) || !Array.isArray(payload.data)) throw discoveryError('MODEL_DISCOVERY_INVALID_RESPONSE');
        const unique = new Map<string, { id: string; name?: string }>();
        for (const item of payload.data) {
          if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 200
            || (item.name !== undefined && (typeof item.name !== 'string' || item.name.length > 500))) throw discoveryError('MODEL_DISCOVERY_INVALID_RESPONSE');
          if (unique.size < 500) unique.set(item.id, { id: item.id, ...(item.name ? { name: item.name } : {}) });
        }
        return [...unique.values()];
      })()]);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw discoveryError('MODEL_DISCOVERY_NETWORK');
    } finally { clearTimeout(timer); controller.abort(); void reader?.cancel().catch(() => undefined); }
  }

  async discoverBatch(input: ProviderDiscoveryBatchInput): Promise<ProviderDiscoveryBatchResult> {
    if (!input || !Array.isArray(input.providerIds) || input.providerIds.length < 1 || input.providerIds.length > 20
      || input.providerIds.some(id => typeof id !== 'string' || !id || id.length > 200)
      || new Set(input.providerIds).size !== input.providerIds.length
      || (input.failedOnly !== undefined && typeof input.failedOnly !== 'boolean')) throw new ProviderError('请选择 1–20 个不同供应商。', 400, 'INVALID_PROVIDER_BATCH');
    const data = await this.ensureSeed();
    const targets = input.providerIds.map(id => {
      const provider = data.providers.find(item => item.id === id);
      if (!provider) throw new ProviderError('供应商不存在。', 404, 'PROVIDER_NOT_FOUND');
      return provider;
    });
    const results: ProviderDiscoveryBatchResult['results'] = [];
    let cursor = 0;
    // Three discovery requests at most; ordered per-endpoint results survive partial failures.
    await Promise.all(Array.from({ length: Math.min(3, targets.length) }, async () => {
      while (cursor < targets.length) {
        const index = cursor++, provider = targets[index];
        const health = provider.discoveryHealth;
        if (input.failedOnly && (!health || health.endpointVersion !== provider.updatedAt || !['invalid-key', 'unconfigured', 'degraded'].includes(health.status))) {
          results[index] = { providerId: provider.id, status: 'skipped' }; continue;
        }
        try { await this.discoverModels(provider.id); results[index] = { providerId: provider.id, status: 'succeeded' }; }
        catch (error) {
          if (!(error instanceof ProviderError)) throw error;
          results[index] = { providerId: provider.id, status: 'failed', code: error.code as NonNullable<ProviderDiscoveryBatchResult['results'][number]['code']> };
        }
      }
    }));
    return { catalog: await this.snapshot(), results };
  }

  async updateModel(modelId: string, changes: { favorite?: boolean; pinned?: boolean }): Promise<ProviderSnapshot> {
    let found = false;
    await this.store.update(data => ({ ...data, models: data.models.map(model => {
      if (model.id !== modelId) return model;
      found = true;
      return { ...model, ...(typeof changes.favorite === 'boolean' ? { favorite: changes.favorite } : {}), ...(typeof changes.pinned === 'boolean' ? { pinned: changes.pinned } : {}) };
    }) }));
    if (!found) throw new ProviderError('模型不存在。', 404, 'MODEL_NOT_FOUND');
    return this.snapshot();
  }

  async selectModel(modelId: string): Promise<ProviderSnapshot> {
    await this.store.update(data => {
      if (!data.models.some(model => model.id === modelId)) throw new ProviderError('模型不存在。', 404, 'MODEL_NOT_FOUND');
      return { ...data, activeModelId: modelId };
    });
    return this.snapshot();
  }

  async completeActive(request: CompletionRequest) {
    const data = await this.ensureSeed();
    if (!data.activeModelId) throw new ProviderError('请先在模型设置中选择一个模型。', 503, 'MODEL_NOT_SELECTED');
    return this.completeModel(data.activeModelId, request);
  }

  async completeModel(modelRecordId: string, request: CompletionRequest) {
    const data = await this.ensureSeed();
    const model = data.models.find(item => item.id === modelRecordId);
    const provider = data.providers.find(item => item.id === model?.providerId);
    if (!model || !provider) throw new ProviderError('请先在模型设置中选择一个模型。', 503, 'MODEL_NOT_SELECTED');
    const ai = new OpenAiCompatibleProvider({ ...this.envConfig, baseUrl: provider.baseUrl, chatPath: provider.chatPath, providerName: provider.name, model: model.modelId, apiKey: await this.vault.decrypt(provider.apiKey), allowNoKey: provider.allowNoKey }, this.fetcher);
    return { text: await ai.complete(request), model: model.modelId, provider: provider.name };
  }

  async streamModel(modelRecordId: string, request: CompletionRequest) {
    const data = await this.ensureSeed();
    const model = data.models.find(item => item.id === modelRecordId);
    const provider = data.providers.find(item => item.id === model?.providerId);
    if (!model || !provider) throw new ProviderError('请先在模型设置中选择一个模型。', 503, 'MODEL_NOT_SELECTED');
    const frozen = request.modelSnapshot;
    if (frozen && (frozen.providerEndpointRef !== provider.id || frozen.endpointVersion !== provider.updatedAt || frozen.model !== model.modelId || frozen.endpoint?.baseUrl !== provider.baseUrl || frozen.endpoint?.chatPath !== provider.chatPath || frozen.endpoint?.allowNoKey !== provider.allowNoKey)) throw new ProviderError('模型或供应商配置已变化，请创建新的执行。', 409, 'PROVIDER_CONFIGURATION_CHANGED');
    const ai = new OpenAiCompatibleProvider({ ...this.envConfig, baseUrl: request.modelSnapshot?.endpoint?.baseUrl ?? provider.baseUrl, chatPath: request.modelSnapshot?.endpoint?.chatPath ?? provider.chatPath, providerName: request.modelSnapshot?.provider ?? provider.name, model: request.modelSnapshot?.model ?? model.modelId, apiKey: await this.vault.decrypt(provider.apiKey), allowNoKey: request.modelSnapshot?.endpoint?.allowNoKey ?? provider.allowNoKey }, this.fetcher);
    return { stream: ai.stream(request), model: model.modelId, provider: provider.name };
  }

  private async ensureSeed() {
    let data = await this.store.read();
    if (!this.seeded && data.providers.length === 0) {
      const preset: ProviderPreset = 'custom';
      await this.saveProvider({ preset, name: this.envConfig.providerName, baseUrl: this.envConfig.baseUrl, apiKey: this.envConfig.apiKey, allowNoKey: this.envConfig.allowNoKey, modelId: this.envConfig.model });
      data = await this.store.read();
    }
    this.seeded = true;
    return data;
  }

  private validateProvider(input: ProviderInput) {
    if (!['openai', 'openrouter', 'deepseek', 'siliconflow', 'ollama', 'custom'].includes(input.preset)) throw new ProviderError('不支持的供应商类型。', 400, 'INVALID_PROVIDER');
    if (!input.name?.trim() || input.name.length > 80) throw new ProviderError('供应商名称不能为空且不能超过 80 字符。', 400, 'INVALID_PROVIDER');
    if (input.modelId && input.modelId.length > 200) throw new ProviderError('模型 ID 不能超过 200 字符。', 400, 'INVALID_MODEL');
    try { const url = new URL(input.baseUrl); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(); }
    catch { throw new ProviderError('Base URL 必须是有效的 HTTP(S) 地址。', 400, 'INVALID_PROVIDER_URL'); }
  }
}
