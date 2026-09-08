import type { PortableWorkspaceFacts } from '../application/ports/portable-workspace';
import type { BundleIndex } from '../domain/portable-bundle';
import { bundleError } from '../domain/portable-bundle';
import { semanticStateChecksum } from './workspace-semantic-checksum';

/** Run after archive digest verification and document schema decoding, before activation. */
export function validatePortableContent(facts: PortableWorkspaceFacts, index: BundleIndex): void {
  if (facts.workspace.projectId !== index.workspaceId) throw bundleError('BUNDLE_WORKSPACE_MISMATCH');
  const entries = new Map(index.entries.map(entry => [entry.path, entry]));
  const requireBlob = (digest: string, size?: number) => {
    const entry = entries.get(`blobs/sha256/${digest}`);
    if (!entry || entry.digest !== `sha256:${digest}`) throw bundleError('BUNDLE_MISSING_CONTENT');
    if (size !== undefined && entry.size !== size) throw bundleError('BUNDLE_SIZE_MISMATCH');
  };
  for (const version of facts.workspace.resourceVersions) requireBlob(version.digest, version.size);
  for (const run of facts.runs) {
    if (semanticStateChecksum({ ...run.input }) !== run.inputHash) throw bundleError('BUNDLE_RUNTIME_DIGEST_MISMATCH');
    requireBlob(run.inputHash);
  }
}
