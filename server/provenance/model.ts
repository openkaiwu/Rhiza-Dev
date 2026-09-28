import type { ContextManifest, DiscussionNode, StoredMessage, ProvenanceLink } from '../domain';
import type { ExecutionRun } from '../execution-runtime/run';
export type { ProvenanceLink } from '../domain';

/** Derive only relationships evidenced by the output and its original execution. */
export function deriveProvenance(workspaceId: string, output: StoredMessage, node: DiscussionNode,
  manifest?: ContextManifest, run?: ExecutionRun): ProvenanceLink {
  if (output.kind !== 'assistant' || output.nodeId !== node.id) throw new Error('INVALID_PROVENANCE_OUTPUT');
  if (manifest && (manifest.projectId !== workspaceId || manifest.nodeId !== node.id || manifest.id !== output.manifestId)) throw new Error('PROVENANCE_SCOPE_MISMATCH');
  if (run && (run.workspaceId !== workspaceId || run.nodeId !== node.id || run.id !== manifest?.requestId
    || run.input.request.manifestId !== manifest.id || run.input.request.projectId !== workspaceId)) throw new Error('PROVENANCE_SCOPE_MISMATCH');
  const missingRefs: string[] = [];
  if (output.manifestId && !manifest) missingRefs.push(`manifest:${output.manifestId}`);
  if (manifest?.schemaVersion === '1.0.0' && !run) missingRefs.push(`run:${manifest.requestId}`);
  return {
    schemaVersion: '1.0.0', id: `provenance:${workspaceId}:${output.id}`, workspaceId, outputRef: output.id,
    inputRefs: [...new Set([...(run?.input.request.history.map(message => message.id) ?? []), ...(output.replyToMessageId ? [output.replyToMessageId] : [])])],
    contextManifestRef: output.manifestId, runRef: run?.id,
    parentRevisionRef: output.sourceMessageId, branchSourceRef: node.sourceMessageId,
    modelSpecRef: run?.input.executor.modelSpecRef, providerEndpointRef: run?.input.executor.providerEndpointRef,
    runtimeSnapshotRef: run ? `run:${run.id}:input:${run.originInputHash ?? run.inputHash}` : undefined,
    status: missingRefs.length ? 'broken-reference' : run ? 'recorded' : 'pre-run', missingRefs, createdAt: output.createdAt,
  };
}
