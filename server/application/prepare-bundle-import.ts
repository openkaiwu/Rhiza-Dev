import type { BundleImportCheckpoint, BundleImportCheckpointPort, BundleImportIdentity } from './ports/bundle-import';
import type { WorkspaceUnitOfWork } from './ports/workspace-unit-of-work';
import type { PortableWorkspaceFacts } from './ports/portable-workspace';

export async function completeBundleImport(identity: BundleImportIdentity, facts: PortableWorkspaceFacts,
  checkpoints: BundleImportCheckpointPort, ingestAndVerify: () => Promise<unknown>, uow: WorkspaceUnitOfWork): Promise<void> {
  if (!uow.activatePortableImport || !uow.withWorkspace) throw new Error('PORTABLE_WORKSPACE_UNAVAILABLE');
  if (identity.workspaceId !== facts.workspace.projectId) throw new Error('BUNDLE_WORKSPACE_MISMATCH');
  await prepareBundleImport(identity, checkpoints, ingestAndVerify);
  await uow.withWorkspace(identity.workspaceId, () => uow.activatePortableImport!(identity.importId, identity.ownerId, facts));
}

/** Content verification precedes the durable phase change, including when resuming blobs-ready. */
export async function prepareBundleImport(identity: BundleImportIdentity, checkpoints: BundleImportCheckpointPort,
  ingestAndVerify: () => Promise<unknown>): Promise<BundleImportCheckpoint> {
  const current = await checkpoints.begin(identity);
  if (current.phase === 'activated') return current;
  await ingestAndVerify();
  if (current.phase === 'blobs-ready') return current;
  try { return await checkpoints.markBlobsReady(identity.importId, identity.ownerId, current.revision); }
  catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'BUNDLE_IMPORT_CONFLICT') throw error;
    const concurrent = await checkpoints.read(identity.importId, identity.ownerId);
    if (!concurrent || concurrent.revision <= current.revision || concurrent.phase === 'validated') throw error;
    return concurrent;
  }
}
