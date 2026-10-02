import { expect, it } from 'vitest';
import { createSeedWorkspace } from '../seed';
import type { PortableWorkspaceFacts } from './ports/portable-workspace';
import { portableDocumentVersion, portableWorkspaceFacts } from './portable-workspace';
import { semanticStateChecksum } from '../infrastructure/workspace-semantic-checksum';

it('keeps legacy document version and preserves new Context decision identity in the explicitly versioned export', () => {
  const workspace = createSeedWorkspace();
  const facts: PortableWorkspaceFacts = { workspace, directory: { workspaceId: workspace.projectId, name: workspace.projectTitle, status: 'active', createdBy: 'owner', revision: 1 }, members: [{ userId: 'owner', role: 'owner' }], runs: [], provenance: [], journal: [] };
  expect(portableDocumentVersion(facts)).toBe('1.0.0');
  workspace.contextItems[0].sourceRevision = 'a'.repeat(64);
  const exported = portableWorkspaceFacts(facts, input => semanticStateChecksum(input as Record<string, unknown>));
  expect(exported.workspace.contextItems[0].sourceRevision).toBe(workspace.contextItems[0].sourceRevision);
  expect(portableDocumentVersion(exported)).toBe('2.0.0');
});
