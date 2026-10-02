import type { BundleExport, PortableBundlePort, PortableWorkspaceFacts } from './ports/portable-workspace';
import type { BundleImportArchivePort, StagedBundleImport } from './ports/bundle-import';
import type { WorkspaceUnitOfWork } from './ports/workspace-unit-of-work';

/** Export and validation are the same production Bundle path; only its durable retention lifecycle differs. */
export async function createManagedBackup(dependencies: { unitOfWork: WorkspaceUnitOfWork; portableBundle?: PortableBundlePort;
  bundleImport?: BundleImportArchivePort; hashPortableFacts?: (facts: PortableWorkspaceFacts) => string }, retryOf?: string) {
  const { unitOfWork, portableBundle, bundleImport, hashPortableFacts } = dependencies;
  if (!portableBundle || !bundleImport || !hashPortableFacts || !unitOfWork.beginManagedBackup
    || !unitOfWork.registerManagedBackup || !unitOfWork.publishManagedBackup || !unitOfWork.failManagedBackup) {
    throw Object.assign(new Error('BACKUP_UNAVAILABLE'), { code: 'BACKUP_UNAVAILABLE', status: 503 });
  }
  const started = await unitOfWork.beginManagedBackup(retryOf);
  if (!started.facts) return started.record;
  let bundle: BundleExport | undefined;
  let staged: StagedBundleImport | undefined;
  const cleanup = async () => {
    try { await staged?.dispose(); } finally { await bundle?.dispose(); }
    staged = undefined; bundle = undefined;
  };
  try {
    bundle = await portableBundle.export(started.facts);
    staged = await bundleImport.receive(bundle.bytes);
    await unitOfWork.registerManagedBackup({ archiveDigest: staged.archiveDigest, stateDigest: hashPortableFacts(staged.facts), sizeBytes: bundle.size });
    const retain = staged.retain;
    return await unitOfWork.publishManagedBackup(async () => { await retain(); await cleanup(); });
  } catch (error) {
    // Do not advertise a terminal state while a plaintext work file may still exist.
    // Cleanup failure leaves running; runtime-owner restart cleanup must complete before interruption/Purge.
    await cleanup();
    const code = (error as { code?: string }).code;
    return await unitOfWork.failManagedBackup(['EACCES', 'EPERM', 'ENOSPC', 'EROFS', 'ENOENT'].includes(code ?? '') ? 'BACKUP_LOCATION_UNAVAILABLE' : 'BACKUP_FAILED');
  }
}
