import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSeedWorkspace } from '../seed';
import { canonicalJson } from '../domain/canonical-json';
import { portableWorkspaceFacts, stripOperationalMetadata } from '../application/portable-workspace';
import type { PortableWorkspaceFacts } from '../application/ports/portable-workspace';

const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
describe('portable export DTO', () => {
  it('removes operational locations and credentials at nested metadata boundaries', () => {
    const source = { text: 'User-authored /Users/example/file discussion', origin_metadata: { username: 'private-name', path: '/private/file' },
      annotations: { internalUrl: 'https://private.test' }, nested: { api_key: 'secret', credential_ref: 'vault-key', safe: 'yes' } };
    expect(stripOperationalMetadata(source)).toEqual({ text: source.text, nested: { safe: 'yes' } });
  });
  it('preserves logical Run identity and original digest while removing endpoint location', () => {
    const workspace = createSeedWorkspace();
    const input = { schemaVersion: '1.0.0' as const, executor: { runtime: 'provider-adapter', modelSpecRef: 'model', providerEndpointRef: 'endpoint', model: 'model', provider: 'Provider' },
      request: { requestId: 'run', manifestId: 'manifest', projectId: workspace.projectId, nodeId: workspace.activeNodeId, modelId: 'model', prompt: 'User question', history: [], contextItems: [], mode: 'Strict' as const,
        modelSnapshot: { id: 'model', provider: 'Provider', model: 'model', displayName: 'Model', active: true, providerEndpointRef: 'endpoint', endpoint: { baseUrl: 'https://internal.test', chatPath: '/chat/completions', allowNoKey: false } } } };
    const originalHash = hash(input);
    const facts: PortableWorkspaceFacts = { workspace, directory: { workspaceId: workspace.projectId, name: 'Workspace', status: 'active', createdBy: 'owner', revision: 1 }, members: [{ userId: 'owner', role: 'owner' }], journal: [], provenance: [],
      runs: [{ id: 'run', workspaceId: workspace.projectId, nodeId: workspace.activeNodeId, commandId: 'command', status: 'completed', attempt: 1, input, inputHash: originalHash, createdAt: workspace.updatedAt, telemetry: { traceCount: 14 } }] };
    const exported = portableWorkspaceFacts(facts, hash);
    expect(JSON.stringify(exported)).not.toContain('internal.test');
    expect(exported.runs[0]).toMatchObject({ id: 'run', originInputHash: originalHash, telemetry: { traceCount: 0 } });
    expect(exported.runs[0].inputHash).toBe(hash(exported.runs[0].input));
    expect(exported.runs[0].inputHash).not.toBe(originalHash);
    expect(portableWorkspaceFacts(exported, hash)).toEqual(exported);
    expect(facts.runs[0].inputHash).toBe(originalHash);
    expect(facts.runs[0].input.request.modelSnapshot?.endpoint?.baseUrl).toBe('https://internal.test');
  });
});
