import type { ProviderPreset, ProviderSnapshot } from '../../provider-domain';

export interface ProviderProfileInput {
  preset: ProviderPreset;
  name: string;
  baseUrl: string;
  apiKey?: string;
  allowNoKey: boolean;
  modelId?: string;
  displayName?: string;
}

/** Structural port implemented by the existing provider catalog service. */
export interface ProviderManagementPort {
  snapshot(): Promise<ProviderSnapshot>;
  activeStatus(): Promise<{ configured: boolean; name: string; model: string; baseUrl: string }>;
  saveProvider(input: ProviderProfileInput, providerId?: string): Promise<ProviderSnapshot>;
  discoverModels(providerId: string): Promise<ProviderSnapshot>;
  updateModel(modelId: string, changes: { favorite?: boolean; pinned?: boolean }): Promise<ProviderSnapshot>;
  selectModel(modelId: string): Promise<ProviderSnapshot>;
}
