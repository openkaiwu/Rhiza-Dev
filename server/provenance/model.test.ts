import { describe, expect, it } from 'vitest';
import { deriveProvenance } from './model';
import { createSeedWorkspace } from '../seed';
import type { ExecutionRun } from '../execution-runtime/run';

function fixture() {
  const workspace = createSeedWorkspace();
  const node = workspace.discussionNodes[0];
  const manifest = { ...workspace.manifests[0], schemaVersion: '1.0.0' as const, id: 'manifest', projectId: workspace.projectId, nodeId: node.id, requestId: 'run' };
  const output = { id: 'output', kind: 'assistant' as const, nodeId: node.id, manifestId: manifest.id, replyToMessageId: 'input', createdAt: workspace.updatedAt, text: 'answer', sourceMessageId: 'older-output' };
  const run: ExecutionRun = { id: 'run', workspaceId: workspace.projectId, nodeId: node.id, commandId: 'command', status: 'completed', attempt: 1,
    inputHash: 'a'.repeat(64), createdAt: workspace.updatedAt, telemetry: { traceCount: 0 },
    input: { schemaVersion: '1.0.0', executor: { runtime: 'provider-adapter', modelSpecRef: 'model', providerEndpointRef: 'endpoint', model: 'model', provider: 'provider' },
      request: { requestId: 'run', manifestId: 'manifest', projectId: workspace.projectId, nodeId: node.id, modelId: 'model', prompt: 'question', mode: 'Strict', history: [{ ...output, id: 'prior', kind: 'user' }], contextItems: [] } } };
  return { workspace, node, manifest, output, run };
}

describe('historical provenance', () => {
  it('records original input, execution and branch/revision relationships without content', () => {
    const { workspace, node, manifest, output, run } = fixture();
    const link = deriveProvenance(workspace.projectId, output, { ...node, sourceMessageId: 'branch-source' }, manifest, run);
    expect(link).toMatchObject({ status: 'recorded', inputRefs: ['prior', 'input'], outputRef: 'output', runRef: 'run', contextManifestRef: 'manifest', modelSpecRef: 'model', providerEndpointRef: 'endpoint', branchSourceRef: 'branch-source', parentRevisionRef: 'older-output', missingRefs: [] });
    expect(link.runtimeSnapshotRef).toContain(run.inputHash);
    expect(JSON.stringify(link)).not.toContain('question');
  });
  it('distinguishes pre-run legacy output from missing modern execution evidence', () => {
    const { workspace, node, manifest, output } = fixture();
    expect(deriveProvenance(workspace.projectId, { ...output, manifestId: undefined }, node).status).toBe('pre-run');
    expect(deriveProvenance(workspace.projectId, output, node, manifest)).toMatchObject({ status: 'broken-reference', missingRefs: ['run:run'] });
    expect(deriveProvenance(workspace.projectId, output, node)).toMatchObject({ status: 'broken-reference', missingRefs: ['manifest:manifest'] });
  });
  it('rejects unrelated manifests and cross-workspace runs', () => {
    const { workspace, node, manifest, output, run } = fixture();
    expect(() => deriveProvenance(workspace.projectId, output, node, { ...manifest, id: 'other' }, run)).toThrow('PROVENANCE_SCOPE_MISMATCH');
    expect(() => deriveProvenance(workspace.projectId, output, node, manifest, { ...run, workspaceId: 'other' })).toThrow('PROVENANCE_SCOPE_MISMATCH');
  });
});
