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
