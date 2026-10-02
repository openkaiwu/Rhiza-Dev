import type { QueryMap } from '../contracts/application';
import { canonicalJson } from '../domain/canonical-json';
import type { WorkspaceUnitOfWork } from './ports/workspace-unit-of-work';
import type { RuntimeModel, RuntimePort } from './ports/runtime';
import type { HostRuntimePort } from './ports/host-runtime';
import type { ExecutionRun } from '../execution-runtime/run';
import { resolveContextHistory } from './context-history';

type Preflight = QueryMap['GetReplayPreflight']['result'];
const policies = ['exact', 'partial', 'current-model'] as const;

function replayDifferences(original: ExecutionRun, model: RuntimeModel, runtime: RuntimePort): string[] {
  const executor = original.input.executor;
  const snapshot = original.input.request.modelSnapshot;
  return [
    original.originInputHash ? 'portable_input_reference' : '',
    model.id !== executor.modelSpecRef || model.model !== executor.model ? 'model' : '',
    model.provider !== executor.provider ? 'provider' : '',
    (model.providerEndpointRef ?? model.id) !== executor.providerEndpointRef ? 'endpoint_reference' : '',
    (runtime.kind ?? 'provider-adapter') !== executor.runtime ? 'runtime' : '',
    model.endpointVersion !== snapshot?.endpointVersion ? 'endpoint_version' : '',
    canonicalJson(model.endpoint ?? null) !== canonicalJson(snapshot?.endpoint ?? null) ? 'endpoint_configuration' : '',
  ].filter(Boolean);
}

/** Shared preflight and dispatch guard. No writes, planning or external generation. */
export async function assessReplay(runId: string, unitOfWork: WorkspaceUnitOfWork, runtime: RuntimePort, host: HostRuntimePort) {
  const blocked = (code: string, missingRefs: string[] = [], sourceManifestId?: string): { preflight: Preflight; ready?: undefined } => ({ preflight: { runId, sourceManifestId, missingRefs, policies: policies.map(policy => ({ policy, allowed: false, code, differences: [] })) } });
  let original: ExecutionRun | undefined;
  try { original = await unitOfWork.getRun?.(runId); }
  catch (error) {
    if ((error as { code?: string }).code === 'RUN_PURGED') return blocked('REPLAY_MISSING_RESOURCE', [`purged:${runId}`]);
    throw error;
  }
  if (!original) return blocked('RUN_NOT_FOUND', [`run:${runId}`]);
  const manifestId = original.input.request.manifestId;
  const facts = await unitOfWork.readContextHistory?.({ manifestId });
  if (!facts || facts.manifest.schemaVersion !== '1.0.0') return blocked('REPLAY_MISSING_RESOURCE', [`manifest:${manifestId}`], manifestId);
  const history = await resolveContextHistory(facts, host.blobs);
  const missing = history.sources.filter(source => source.status !== 'resolved').map(source => `${source.status}:${source.sourceId}`);
  if (missing.length) return blocked('REPLAY_MISSING_RESOURCE', missing, manifestId);
  const current = await unitOfWork.read(workspace => workspace);
  for (const attachment of original.input.request.attachments ?? []) {
    const version = current.resourceVersions.find(value => value.id === attachment.resourceVersionId && value.resourceId === attachment.resourceId && !value.purgedAt);
    if (!attachment.blobRef || !attachment.digest || !attachment.resourceVersionId || !version || version.digest !== attachment.digest || version.blobRef !== attachment.blobRef) return blocked('REPLAY_MISSING_RESOURCE', [`attachment:${attachment.id}`], manifestId);
    try { await host.blobs.read(attachment.blobRef, attachment.digest); }
    catch { return blocked('REPLAY_MISSING_RESOURCE', [`attachment:${attachment.id}`], manifestId); }
  }
  const node = current.discussionNodes.find(node => node.id === original.nodeId);
  if (!node || node.status === 'archived') return blocked('NODE_ARCHIVED', [], manifestId);
  const models = await runtime.listModels();
  const historicalModel = models.find(model => model.id === original!.input.executor.modelSpecRef);
  const currentModel = models.find(model => model.active);
  const preflight: Preflight = { runId, sourceManifestId: manifestId, missingRefs: [], policies: policies.map(policy => {
    const model = policy === 'current-model' ? currentModel : historicalModel;
    if (!model) return { policy, allowed: false, code: 'REPLAY_MODEL_UNAVAILABLE', differences: [] };
    const differences = replayDifferences(original!, model, runtime);
    return { policy, allowed: policy !== 'exact' || differences.length === 0, ...(policy === 'exact' && differences.length ? { code: 'REPLAY_CONTRACT_CHANGED' } : {}), differences };
  }) };
  return { preflight, ready: { original, facts, current, historicalModel, currentModel } };
}
