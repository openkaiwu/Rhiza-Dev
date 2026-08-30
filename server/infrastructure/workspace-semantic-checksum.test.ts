import { describe, expect, it } from 'vitest';
import { createSeedWorkspace } from '../seed';
import { semanticChecksum } from './workspace-semantic-checksum';

describe('Workspace semantic reconciliation', () => {
  it('ignores entity collection and object key order without mutating the input', () => {
    const workspace = createSeedWorkspace();
    const reordered = structuredClone(workspace);
    reordered.messages.reverse();
    reordered.contextItems.reverse();
    reordered.discussionNodes = reordered.discussionNodes.map(node => Object.fromEntries(Object.entries(node).reverse()) as typeof node);
    const before = structuredClone(reordered);
    expect(semanticChecksum(reordered)).toBe(semanticChecksum(workspace));
    expect(reordered).toEqual(before);
  });

  it('detects changed semantic fields and keeps nested ordered values significant', () => {
    const workspace = createSeedWorkspace();
    const changed = structuredClone(workspace);
    changed.discussionNodes[0]!.summary = 'changed';
    expect(semanticChecksum(changed)).not.toBe(semanticChecksum(workspace));
    const ordered = structuredClone(workspace);
    ordered.messages[0]!.attachmentIds = ['first', 'second'];
    const reversed = structuredClone(ordered);
    reversed.messages[0]!.attachmentIds!.reverse();
    expect(semanticChecksum(reversed)).not.toBe(semanticChecksum(ordered));
  });
});
