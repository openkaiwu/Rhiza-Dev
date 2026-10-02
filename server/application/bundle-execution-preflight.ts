import { applicationError } from '../contracts/application-error';
import type { BundleExecutionConfiguration, BundleExecutionMapping, BundleExecutionMappingChoice } from '../contracts/bundle-preflight';
import type { BundleExecutionRequirement } from '../domain/portable-bundle';
import type { ProviderSnapshot } from '../provider-domain';
import { providerDiscoveryFailures } from '../provider-domain';

const sourceKey = (value: { modelSpecRef: string; providerEndpointRef: string }) => JSON.stringify([value.modelSpecRef, value.providerEndpointRef]);
const fields = ['modelSpecRef', 'providerEndpointRef', 'targetModelId', 'targetProviderEndpointRef', 'targetEndpointVersion'] as const;
function invalid(): never { throw applicationError('Bundle 模型映射无效。', 'BUNDLE_INVALID_MAPPING', 'validation'); }

/** A mapping is a future preference plan; it never changes historical Run/Manifest/Journal identities. */
export function assessBundleExecution(requirements: BundleExecutionRequirement[], catalog: ProviderSnapshot, choices?: unknown): BundleExecutionConfiguration {
  const groups = new Map<string, { modelSpecRef: string; providerEndpointRef: string; runCount: number }>();
  for (const requirement of requirements) {
    const key = sourceKey(requirement), previous = groups.get(key);
    if (previous) previous.runCount++;
    else groups.set(key, { modelSpecRef: requirement.modelSpecRef, providerEndpointRef: requirement.providerEndpointRef, runCount: 1 });
  }
  const selected = new Map<string, BundleExecutionMappingChoice>();
  if (choices !== undefined) {
    if (!Array.isArray(choices) || choices.length > 64) invalid();
    for (const value of choices) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key as typeof fields[number]))
        || fields.some(key => typeof value[key] !== 'string' || !value[key] || value[key].trim() !== value[key] || value[key].length > 200
          || [...value[key] as string].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))) invalid();
      const key = sourceKey(value);
      if (!groups.has(key) || selected.has(key)) invalid();
      selected.set(key, Object.fromEntries(fields.map(field => [field, value[field]])) as unknown as BundleExecutionMappingChoice);
    }
  }
  const models = new Map(catalog.models.map(model => [model.id, model]));
  const providers = new Map(catalog.providers.map(provider => [provider.id, provider]));
  const mappings: BundleExecutionMapping[] = []; let ready = true;
  for (const [key, group] of groups) {
    const target = selected.get(key) ?? null;
    const model = target && models.get(target.targetModelId);
    const provider = target && providers.get(target.targetProviderEndpointRef);
    const health = provider && provider.discoveryHealth?.endpointVersion === provider.updatedAt ? provider.discoveryHealth : undefined;
    const credentialStatus = !provider ? 'unknown' : health?.status === 'invalid-key' ? 'known-invalid'
      : provider.allowNoKey ? 'not-required' : provider.hasApiKey ? 'configured' : 'required';
    const reason = !target ? 'mapping_required' : !model ? 'model_missing' : !provider ? 'endpoint_missing'
      : model.providerId !== provider.id ? 'endpoint_mismatch' : target.targetEndpointVersion !== provider.updatedAt ? 'endpoint_changed'
      : credentialStatus === 'known-invalid' ? 'credential_invalid' : credentialStatus === 'required' ? 'credential_required' : undefined;
    if (reason) ready = false;
    if (mappings.length < 1000) mappings.push({ ...group, target, currentEndpointVersion: provider?.updatedAt ?? null,
      status: !target ? 'unresolved' : reason ? 'blocked' : 'ready', ...(reason ? { reason } : {}), credentialStatus,
      discoveryStatus: health?.status ?? 'unknown',
      ...(health?.code && (health.code === 'MODEL_DISCOVERY_OK' || Object.hasOwn(providerDiscoveryFailures, health.code)) ? { discoveryCode: health.code } : {}) });
  }
  return { ready, mappingCount: groups.size, mappings, truncated: groups.size > mappings.length };
}
