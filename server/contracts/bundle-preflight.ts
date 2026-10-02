export interface BundleExecutionMappingChoice {
  modelSpecRef: string;
  providerEndpointRef: string;
  targetModelId: string;
  targetProviderEndpointRef: string;
  targetEndpointVersion: string;
}

export interface BundleExecutionMapping {
  modelSpecRef: string;
  providerEndpointRef: string;
  runCount: number;
  target: BundleExecutionMappingChoice | null;
  currentEndpointVersion: string | null;
  status: 'ready' | 'unresolved' | 'blocked';
  reason?: 'mapping_required' | 'model_missing' | 'endpoint_missing' | 'endpoint_mismatch' | 'endpoint_changed' | 'credential_required' | 'credential_invalid';
  credentialStatus: 'unknown' | 'required' | 'configured' | 'not-required' | 'known-invalid';
  discoveryStatus: 'unknown' | 'healthy' | 'degraded' | 'invalid-key' | 'unconfigured';
  discoveryCode?: string;
}

/** Configuration presence and known diagnostics, without a remote authentication or model probe. */
export interface BundleExecutionConfiguration {
  ready: boolean;
  mappingCount: number;
  mappings: BundleExecutionMapping[];
  truncated: boolean;
}
