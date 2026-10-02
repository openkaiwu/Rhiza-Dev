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
  /** Production adapter holds the Workspace/content lifecycle locks during archive publication. */
  retainArchive?(identity: BundleImportIdentity, retain: () => Promise<void>): Promise<void>;
  read(importId: string, ownerId: string): Promise<BundleImportCheckpoint | undefined>;
  markBlobsReady(importId: string, ownerId: string, expectedRevision: number): Promise<BundleImportCheckpoint>;
}
export interface StagedBundleImport {
  facts: import('./portable-workspace').PortableWorkspaceFacts;
  assessment: import('../../domain/portable-bundle').BundleContentAssessment;
  archiveDigest: string;
  retain(): Promise<void>;
  ingest(): Promise<import('./portable-workspace').PortableWorkspaceFacts>;
  hydrate(resources: AsyncIterable<import('../../domain/portable-bundle').ProvidedBundleResource>): Promise<import('../../domain/portable-bundle').BundleExport>;
  dispose(): Promise<void>;
}
export interface BundleImportArchivePort {
  receive(bytes: AsyncIterable<Uint8Array>): Promise<StagedBundleImport>;
}
