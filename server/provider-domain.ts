export type ProviderPreset = 'openai' | 'openrouter' | 'deepseek' | 'siliconflow' | 'ollama' | 'custom';

export interface EncryptedSecret { iv: string; tag: string; data: string }

export type DiscoveryCode = 'MODEL_DISCOVERY_OK' | 'PROVIDER_NOT_CONFIGURED' | 'PROVIDER_INVALID_KEY'
  | 'MODEL_DISCOVERY_UNSUPPORTED' | 'MODEL_DISCOVERY_RATE_LIMITED' | 'MODEL_DISCOVERY_TIMEOUT'
  | 'MODEL_DISCOVERY_NETWORK' | 'MODEL_DISCOVERY_INVALID_RESPONSE' | 'MODEL_DISCOVERY_FAILED';
export const providerDiscoveryFailures = {
  PROVIDER_NOT_CONFIGURED: { message: '请先保存 API Key，或明确允许无密钥的本地端点。', status: 400, retryable: false, recovery: 'select_model' },
  PROVIDER_INVALID_KEY: { message: '供应商拒绝了模型目录凭据，请检查密钥及其权限后重试。', status: 502, retryable: false, recovery: 'select_model' },
  MODEL_DISCOVERY_UNSUPPORTED: { message: '端点未提供模型目录，可手动添加模型 ID 后尝试对话。', status: 502, retryable: false, recovery: 'select_model' },
  MODEL_DISCOVERY_RATE_LIMITED: { message: '模型目录请求受到限流，请稍后刷新。', status: 502, retryable: true, recovery: 'retry' },
  MODEL_DISCOVERY_TIMEOUT: { message: '模型目录请求超时，请检查端点后重试。', status: 504, retryable: true, recovery: 'retry' },
  MODEL_DISCOVERY_NETWORK: { message: '无法连接模型目录，请检查端点和网络。', status: 502, retryable: true, recovery: 'retry' },
  MODEL_DISCOVERY_INVALID_RESPONSE: { message: '模型目录响应格式或大小无效，已有模型已保留。', status: 502, retryable: false, recovery: 'select_model' },
  MODEL_DISCOVERY_FAILED: { message: '模型目录暂不可用，已有模型已保留。', status: 502, retryable: true, recovery: 'retry' },
} as const;
/** Observation of /models only; never an authorization or Chat capability verdict. */
export interface ProviderDiscoveryHealth {
  status: 'unknown' | 'healthy' | 'degraded' | 'invalid-key' | 'unconfigured';
  endpointVersion: string;
  checkedAt?: string;
  code?: DiscoveryCode;
  discoveredCount?: number;
}

export interface ProviderCatalogQuery {
  search?: string;
  providerId?: string;
  favorite?: boolean;
  pinned?: boolean;
  sort?: 'preferred' | 'name' | 'provider';
}

export interface ProviderDiscoveryBatchInput { providerIds: string[]; failedOnly?: boolean }
export interface ProviderDiscoveryBatchResult {
  catalog: ProviderSnapshot;
  results: Array<{ providerId: string; status: 'succeeded' | 'failed' | 'skipped'; code?: DiscoveryCode | 'PROVIDER_CONFIGURATION_CHANGED' }>;
}

export interface StoredProvider {
  id: string;
  preset: ProviderPreset;
  name: string;
  baseUrl: string;
  chatPath: string;
  allowNoKey: boolean;
  apiKey?: EncryptedSecret;
  createdAt: string;
  updatedAt: string;
  discoveryHealth?: ProviderDiscoveryHealth;
}

export interface ModelRecord {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  favorite: boolean;
  pinned: boolean;
  createdAt: string;
}

export interface ProviderData {
  providers: StoredProvider[];
  models: ModelRecord[];
  activeModelId: string | null;
  updatedAt: string;
}

export interface SafeProvider extends Omit<StoredProvider, 'apiKey'> {
  hasApiKey: boolean;
  configured: boolean;
}

export interface ProviderSnapshot {
  providers: SafeProvider[];
  models: ModelRecord[];
  activeModelId: string | null;
  modelSpecs: Array<{
    name: string;
    label: string;
    group?: string;
    description?: string;
    preset: { endpoint?: string | null; endpointType?: string | null; model?: string | null };
  }>;
  filePolicy: {
    disabled: boolean;
    maxFiles: number;
    maxFileSizeBytes: number;
    maxTotalSizeBytes: number;
    fileTokenLimit: number;
    supportedMimeTypes: string[];
  };
}
