import { describe, expect, it } from 'vitest';
import { createSeedWorkspace } from './seed';
import { validateWorkspaceHistoryUpdate } from './store';

describe('M10 immutable Message history', () => {
  it.each(['text', 'reasoning', 'manifestId', 'nodeId', 'version', 'attachmentIds'] as const)('rejects rewriting %s on an existing Message', field => {
    const previous = createSeedWorkspace();
    const next = structuredClone(previous);
    Object.assign(next.messages[0], { [field]: field === 'version' ? 99 : field === 'attachmentIds' ? ['foreign'] : 'rewritten' });
    expect(() => validateWorkspaceHistoryUpdate(previous, next)).toThrow(/Immutable Message/);
  });
  it('allows a segment relationship adjustment without rewriting content', () => {
    const previous = createSeedWorkspace();
    const next = structuredClone(previous);
    next.messages[0].segmentId = 'new-segment';
    expect(() => validateWorkspaceHistoryUpdate(previous, next)).not.toThrow();
  });
});
