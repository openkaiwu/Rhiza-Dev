import type { PortableWorkspaceFacts } from '../application/ports/portable-workspace';
import type { BundleIndex } from '../domain/portable-bundle';
import { bundleError } from '../domain/portable-bundle';
import { semanticStateChecksum } from './workspace-semantic-checksum';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { portableWorkspaceSchema } from '../domain/portable-workspace-schema';
import journalSchema from '../contracts/domain-event-envelope.schema.json';
import { validatePortableReferences } from '../application/portable-references';
import { validatePortableHistory } from '../application/portable-history';

interface PortableDocument {
  facts: PortableWorkspaceFacts;
  runtimeSnapshots: Array<{ id: string; runRef: string; digest: string }>;
  providerEndpoints: Array<{ id: string; runRef: string; providerType: string; configurationVersion: string | null }>;
  modelSpecs: Array<{ id: string; runRef: string; model: string; provider: string }>;
}
const ajv = new Ajv2020({ strict: true });
addFormats(ajv); ajv.addSchema(journalSchema);
// Only the locally shipped schema is executable; schemas included in archives are documentation.
const validateDocument = ajv.compile<PortableDocument>(portableWorkspaceSchema);

export function decodePortableDocument(value: unknown, index: BundleIndex): PortableWorkspaceFacts {
  if (!validateDocument(value)) throw bundleError('BUNDLE_INVALID_DOCUMENT');
  const { facts, runtimeSnapshots, providerEndpoints, modelSpecs } = value;
  validatePortableReferences(facts);
  validatePortableContent(facts, index);
  validatePortableHistory(facts, semanticStateChecksum);
  const byRun = <T extends { runRef: string }>(items: T[]) => {
    const result = new Map(items.map(item => [item.runRef, item]));
    if (result.size !== items.length || result.size !== facts.runs.length) throw bundleError('BUNDLE_DESCRIPTOR_MISMATCH');
    return result;
  };
  const snapshots = byRun(runtimeSnapshots), endpoints = byRun(providerEndpoints), models = byRun(modelSpecs);
  for (const run of facts.runs) {
    const snapshot = snapshots.get(run.id), endpoint = endpoints.get(run.id), model = models.get(run.id);
    if (snapshot?.id !== `run:${run.id}:input:${run.originInputHash ?? run.inputHash}` || snapshot.digest !== `sha256:${run.inputHash}`
      || endpoint?.id !== run.input.executor.providerEndpointRef || endpoint.providerType !== run.input.executor.provider
      || endpoint.configurationVersion !== (run.input.request.modelSnapshot?.endpointVersion ?? null)
      || model?.id !== run.input.executor.modelSpecRef || model.model !== run.input.executor.model || model.provider !== run.input.executor.provider) {
      throw bundleError('BUNDLE_DESCRIPTOR_MISMATCH');
    }
  }
  return structuredClone(facts);
}

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
