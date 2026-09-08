import type { BundleImportCheckpoint, BundleImportCheckpointPort, BundleImportIdentity } from './ports/bundle-import';

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
