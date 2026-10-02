import { expect, it } from 'vitest';
import type { ProviderSnapshot } from '../provider-domain';
import { assessBundleExecution } from './bundle-execution-preflight';

const requirements = [{ runRef: 'run-a', modelSpecRef: 'source-model', providerEndpointRef: 'source-endpoint', endpointVersion: 'source-version', credentialRequired: true as const }];
const choice = { modelSpecRef: 'source-model', providerEndpointRef: 'source-endpoint', targetModelId: 'local-model', targetProviderEndpointRef: 'local-endpoint', targetEndpointVersion: 'local-version' };
function catalog(): ProviderSnapshot {
  return { providers: [{ id: 'local-endpoint', preset: 'custom', name: 'Ambiguous name', baseUrl: 'https://private.example.test', chatPath: '/private', allowNoKey: false, hasApiKey: true, configured: true, createdAt: 'created', updatedAt: 'local-version' }],
    models: [{ id: 'local-model', providerId: 'local-endpoint', modelId: 'source-model', displayName: 'Ambiguous name', favorite: false, pinned: false, createdAt: 'created' }], activeModelId: 'local-model', modelSpecs: [],
    filePolicy: { disabled: false, maxFiles: 1, maxFileSizeBytes: 1, maxTotalSizeBytes: 1, fileTokenLimit: 1, supportedMimeTypes: [] } };
}

it('requires explicit model and endpoint choices, groups historical references, and projects only safe readiness metadata', () => {
  const local = catalog();
  expect(assessBundleExecution(requirements, local)).toMatchObject({ ready: false, mappingCount: 1, mappings: [{ status: 'unresolved', reason: 'mapping_required', target: null }] });
  const ready = assessBundleExecution([...requirements, { ...requirements[0], runRef: 'run-b' }], local, [choice]);
  expect(ready).toMatchObject({ ready: true, mappingCount: 1, mappings: [{ status: 'ready', runCount: 2, credentialStatus: 'configured', target: choice, currentEndpointVersion: 'local-version' }] });
  expect(JSON.stringify(ready)).not.toMatch(/private|baseUrl|chatPath|apiKey|Ambiguous name/);
  expect(assessBundleExecution([], local)).toEqual({ ready: true, mappingCount: 0, mappings: [], truncated: false });
  expect(requirements[0].endpointVersion).toBe('source-version'); expect(local.activeModelId).toBe('local-model');
});

it('distinguishes missing, deliberately no-key, known-invalid and degraded discovery configuration without probing a provider', () => {
  const local = catalog(), provider = local.providers[0];
  provider.hasApiKey = false; provider.configured = false;
  expect(assessBundleExecution(requirements, local, [choice])).toMatchObject({ ready: false, mappings: [{ reason: 'credential_required', credentialStatus: 'required' }] });
  provider.allowNoKey = true;
  expect(assessBundleExecution(requirements, local, [choice])).toMatchObject({ ready: true, mappings: [{ credentialStatus: 'not-required' }] });
  provider.discoveryHealth = { status: 'invalid-key', endpointVersion: provider.updatedAt, code: 'PROVIDER_INVALID_KEY' };
  expect(assessBundleExecution(requirements, local, [choice])).toMatchObject({ ready: false, mappings: [{ reason: 'credential_invalid', credentialStatus: 'known-invalid', discoveryStatus: 'invalid-key' }] });
  provider.discoveryHealth = { status: 'degraded', endpointVersion: provider.updatedAt, code: 'MODEL_DISCOVERY_UNSUPPORTED' };
  expect(assessBundleExecution(requirements, local, [choice])).toMatchObject({ ready: true, mappings: [{ discoveryStatus: 'degraded', discoveryCode: 'MODEL_DISCOVERY_UNSUPPORTED' }] });
  provider.discoveryHealth = { status: 'invalid-key', endpointVersion: 'stale-version', code: 'PROVIDER_INVALID_KEY' };
  expect(assessBundleExecution(requirements, local, [choice])).toMatchObject({ ready: true, mappings: [{ discoveryStatus: 'unknown' }] });
});

it('rejects forged mapping plans, reevaluates changed local models/endpoints, and bounds the presentation list', () => {
  const local = catalog();
  for (const forged of [null, {}, [choice, choice], [{ ...choice, modelSpecRef: 'unknown-source' }], [{ ...choice, apiKey: 'forbidden' }], [{ ...choice, targetModelId: '' }], [{ ...choice, targetEndpointVersion: 'bad\nversion' }], Array(65).fill(choice)]) {
    expect(() => assessBundleExecution(requirements, local, forged)).toThrowError(expect.objectContaining({ details: { code: 'BUNDLE_INVALID_MAPPING', category: 'validation', recovery: 'none', retryable: false, status: 400 } }));
  }
  local.providers[0].updatedAt = 'changed-version';
  expect(assessBundleExecution(requirements, local, [choice])).toMatchObject({ ready: false, mappings: [{ reason: 'endpoint_changed', currentEndpointVersion: 'changed-version' }] });
  local.models[0].providerId = 'other-endpoint';
  expect(assessBundleExecution(requirements, local, [choice])).toMatchObject({ ready: false, mappings: [{ reason: 'endpoint_mismatch' }] });
  local.models = [];
  expect(assessBundleExecution(requirements, local, [choice])).toMatchObject({ ready: false, mappings: [{ reason: 'model_missing' }] });
  local.models = catalog().models; local.providers = [];
  expect(assessBundleExecution(requirements, local, [choice])).toMatchObject({ ready: false, mappings: [{ reason: 'endpoint_missing' }] });
  const many = Array.from({ length: 1001 }, (_, n) => ({ ...requirements[0], runRef: `run-${n}`, modelSpecRef: `source-${n}` }));
  expect(assessBundleExecution(many, catalog())).toMatchObject({ ready: false, mappingCount: 1001, truncated: true });
  expect(assessBundleExecution(many, catalog()).mappings).toHaveLength(1000);
});
