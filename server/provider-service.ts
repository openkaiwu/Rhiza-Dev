import { randomUUID } from 'node:crypto';
import { OpenAiCompatibleProvider, ProviderError } from './ai-provider';
import type { AiConfig } from './config';
import type { ContextItem, StoredMessage } from './domain';
import { libreChatEndpointForPreset, libreChatFilePolicy, toLibreChatModelSpec } from './librechat-shared';
import type { ModelRecord, ProviderPreset, ProviderSnapshot, StoredProvider } from './provider-domain';
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

export class ProviderService {
  private seeded = false;
  constructor(private readonly store: ProviderStore, private readonly vault: SecretVault, private readonly envConfig: AiConfig, private readonly fetcher: typeof fetch = fetch) {}

  async snapshot(): Promise<ProviderSnapshot> {
    const data = await this.ensureSeed();
    const providers = data.providers.map(({ apiKey, ...provider }) => ({ ...provider, hasApiKey: Boolean(apiKey), configured: Boolean(apiKey) || provider.allowNoKey }));
    const models = [...data.models].sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(b.favorite) - Number(a.favorite) || a.displayName.localeCompare(b.displayName));
    const activeModel = models.find(model => model.id === data.activeModelId);
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
      const provider: StoredProvider = { id, preset: input.preset, name: input.name.trim(), baseUrl: input.baseUrl.replace(/\/$/, ''), chatPath: '/chat/completions', allowNoKey: input.allowNoKey, apiKey, createdAt: previous?.createdAt || now, updatedAt: now };
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
    const apiKey = await this.vault.decrypt(provider.apiKey);
    if (!apiKey && !provider.allowNoKey) throw new ProviderError('请先保存 API Key。', 400, 'PROVIDER_NOT_CONFIGURED');
    const response = await this.fetcher(`${provider.baseUrl}/models`, { headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) } });
    if (!response.ok) throw new ProviderError(`获取模型失败（${response.status}）。请检查地址和密钥。`, 502, 'MODEL_DISCOVERY_FAILED');
    const payload = await response.json() as { data?: Array<{ id?: string; name?: string }> };
    const discovered = (payload.data || []).filter(item => typeof item.id === 'string' && item.id).slice(0, 500);
    await this.store.update(current => {
      for (const item of discovered) {
        if (current.models.some(model => model.providerId === providerId && model.modelId === item.id)) continue;
        current.models.push({ id: randomUUID(), providerId, modelId: item.id!, displayName: item.name || item.id!, favorite: false, pinned: false, createdAt: new Date().toISOString() });
      }
      current.activeModelId ??= current.models.find(model => model.providerId === providerId)?.id || null;
      return current;
    });
    return this.snapshot();
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
