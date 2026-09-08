export interface BundleImportIdentity {
  importId: string;
  ownerId: string;
  workspaceId: string;
  archiveDigest: string;
  stateDigest: string;
}
export interface BundleImportCheckpoint extends BundleImportIdentity {
  phase: 'validated' | 'blobs-ready' | 'activated';
  revision: number;
}
export interface BundleImportCheckpointPort {
  begin(identity: BundleImportIdentity): Promise<BundleImportCheckpoint>;
  read(importId: string, ownerId: string): Promise<BundleImportCheckpoint | undefined>;
  markBlobsReady(importId: string, ownerId: string, expectedRevision: number): Promise<BundleImportCheckpoint>;
}
export interface StagedBundleImport {
  facts: import('./portable-workspace').PortableWorkspaceFacts;
  archiveDigest: string;
  retain(): Promise<void>;
  ingest(): Promise<unknown>;
  dispose(): Promise<void>;
}
export interface BundleImportArchivePort {
  receive(bytes: AsyncIterable<Uint8Array>): Promise<StagedBundleImport>;
}
