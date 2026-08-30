export type HostCapabilityState = 'available' | 'degraded' | 'unavailable';

export interface HostCapabilityDescriptor {
  host: 'node' | 'headless';
  fileAccess: HostCapabilityState;
  pathNormalization: HostCapabilityState;
  blobStorage: HostCapabilityState;
  credentialAccess: HostCapabilityState;
  spawn: 'unavailable';
  desktop: 'unavailable';
}

export interface BlobPutResult {
  digestAlgorithm: 'sha256';
  digest: string;
  blobRef: string;
  size: number;
}

export interface BlobGcResult {
  deleted: string[];
  retained: string[];
}

export interface BlobStorePort {
  put(bytes: Uint8Array): Promise<BlobPutResult>;
  read(blobRef: string, expectedDigest: string): Promise<Uint8Array>;
  collectOrphans(referencedBlobRefs: ReadonlySet<string>, gracePeriodMs: number, now?: number): Promise<BlobGcResult>;
}

export type HostCredentialResult =
  | { state: 'available'; value: string }
  | { state: 'unavailable' | 'degraded'; reason: string };

/** Current Chat host contract. Process/Desktop capabilities intentionally remain unavailable until M24/M29. */
export interface HostRuntimePort {
  describe(): HostCapabilityDescriptor;
  normalizePath(path: string): string;
  blobs: BlobStorePort;
  readCredential(name: string): Promise<HostCredentialResult>;
  readLegacyAttachment?(key: string): Promise<Uint8Array>;
}
