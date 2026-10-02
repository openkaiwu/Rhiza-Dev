// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { exportSecurityFixture } from '../../scripts/security/export-fixture';
import { workspaceSemanticSnapshot } from '../domain-journal';
import { stagePortableWorkspace } from './portable-content';
import { semanticStateChecksum } from './workspace-semantic-checksum';

it('omits operational token, path and location extensions from real exports while preserving business content and history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-export-metadata-test-'));
  try {
    const text = 'Discuss /private/business.md at latitude 37.333; access_token is a field in the design.';
    const sentinel = 'operational-only-sentinel';
    const fixture = await exportSecurityFixture(root, { text, metadata: {
      access_token: sentinel, refreshToken: sentinel, 'auth-token': sentinel,
      path: `/private/${sentinel}`, location: { latitude: sentinel, longitude: sentinel },
      nested: [{ ACCESS_TOKEN: sentinel, 'refresh-token': sentinel, latitude: sentinel, longitude: sentinel, geoLocation: sentinel }],
      tokenCount: 10, notes: text,
    } });
    const original = structuredClone(fixture.facts);
    const path = join(root, 'workspace.rhiza'); await fixture.exportTo(path);
    const staged = await stagePortableWorkspace(path, undefined, root);
    try {
      expect((await readFile(staged.files.get('workspace.json')!, 'utf8')).includes(sentinel)).toBe(false);
      expect(staged.facts.workspace.messages[0].text).toBe(text);
      expect(staged.facts.journal[0].payload).toMatchObject({ notes: text, tokenCount: 10, nested: [{}] });
      expect(staged.facts.journal[0].payload.portableStateChecksum).toMatch(/^[a-f0-9]{64}$/);
      const secondPath = join(root, 'reexport.rhiza'); await fixture.exportTo(secondPath, staged.facts);
      const second = await stagePortableWorkspace(secondPath, undefined, root);
      try { expect(second.facts).toEqual(staged.facts); } finally { await second.dispose(); }
      expect(fixture.facts).toEqual(original);
    } finally { await staged.dispose(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('recomputes a valid legacy portable checksum after metadata removal without accepting corrupted history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-export-checksum-test-'));
  try {
    const fixture = await exportSecurityFixture(root);
    const { workspace } = fixture.facts;
    workspace.manifests.push({ id: 'legacy-manifest', projectId: workspace.projectId, nodeId: workspace.activeNodeId, requestId: 'legacy-request',
      createdAt: workspace.updatedAt, mode: 'Strict', model: 'model', provider: 'Provider', runtime: 'provider-adapter', contextItemIds: [], excludedItemIds: [],
      contextItems: [], estimatedTokens: 0, generation: { temperature: 0.7, topP: 1, maxTokens: 1024 }, operation: 'send', attachmentIds: [],
      cache: { key: 'cache', reason: 'fixture', vector: { path: '/private/legacy-operational-sentinel', ordinary: 'keep' } } });
    const state = workspaceSemanticSnapshot(workspace);
    const payload = fixture.facts.journal[0].payload;
    payload.snapshot = { stateSchema: 'rhiza.workspace-semantic.v1', sourceSequence: 0, state };
    payload.portableStateChecksum = semanticStateChecksum(state);
    const path = join(root, 'legacy-reexport.rhiza'); await fixture.exportTo(path);
    const staged = await stagePortableWorkspace(path, undefined, root);
    try {
      expect(staged.facts.workspace.manifests[0].cache?.vector).toEqual({ ordinary: 'keep' });
      expect(staged.facts.journal[0].payload.portableStateChecksum).not.toBe(payload.portableStateChecksum);
    } finally { await staged.dispose(); }
    const corrupt = structuredClone(fixture.facts);
    const snapshot = corrupt.journal[0].payload.snapshot as { state: { projectTitle: string } };
    snapshot.state.projectTitle = 'corrupted business history';
    await expect(fixture.exportTo(join(root, 'corrupted.rhiza'), corrupt)).rejects.toThrow('BUNDLE_EVENT_STATE_MISMATCH');
  } finally { await rm(root, { recursive: true, force: true }); }
});
