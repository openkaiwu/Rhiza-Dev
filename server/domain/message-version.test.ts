import { describe, expect, it } from 'vitest';
import { deriveVersionIdentity } from './message-version';
import type { StoredMessage } from '../domain';

const message = (id: string, kind: 'user' | 'assistant', group?: string, version?: number, replyToMessageId?: string): StoredMessage => ({
  id, kind, nodeId: 'node-a', text: id, createdAt: '2026-01-01T00:00:00.000Z', versionGroupId: group, version, replyToMessageId,
});

describe('deriveVersionIdentity', () => {
  it('starts sends in their own group and advances edits/regenerations in the source user group', () => {
    const first = message('user-1', 'user', 'user-1', 1);
    const assistant = message('assistant-1', 'assistant', 'user-1', 1, 'user-1');
    const edited = deriveVersionIdentity({ operation: 'edit-resend', userMessageId: 'user-2', source: first, messages: [first, assistant] });
    const regenerated = deriveVersionIdentity({ operation: 'regenerate', userMessageId: 'user-3', source: assistant, messages: [first, assistant, message('user-2', 'user', 'user-1', 2)] });
    expect(deriveVersionIdentity({ operation: 'send', userMessageId: 'fresh', messages: [] })).toEqual({ versionGroupId: 'fresh', version: 1 });
    expect(edited).toEqual({ versionGroupId: 'user-1', version: 2 });
    expect(regenerated).toEqual({ versionGroupId: 'user-1', version: 3 });
  });

  it('is deterministic, leaves inputs untouched, and never considers another version group', () => {
    let seed = 0x5eeda11;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const group = `group-${random() % 7}`;
      const otherGroup = `other-${random() % 7}`;
      const messages = [
        message(`source-${iteration}`, 'user', group, 1),
        ...Array.from({ length: random() % 25 }, (_, index) => message(`m-${iteration}-${index}`, index % 2 ? 'assistant' : 'user', index % 3 ? group : otherGroup, 1 + random() % 9)),
      ];
      const snapshot = structuredClone(messages);
      const input = { operation: 'edit-resend' as const, userMessageId: `new-${iteration}`, source: messages[0], messages };
      const first = deriveVersionIdentity(input);
      const second = deriveVersionIdentity(input);
      const expected = Math.max(0, ...messages.filter(item => item.versionGroupId === group).map(item => item.version || 1)) + 1;
      expect(first).toEqual(second);
      expect(first).toEqual({ versionGroupId: group, version: expected });
      expect(messages).toEqual(snapshot);
    }
  });
});
