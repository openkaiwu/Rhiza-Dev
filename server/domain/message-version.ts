import type { ChatOperation, StoredMessage } from '../domain';

export interface VersionIdentity {
  versionGroupId: string;
  version: number;
}

export interface VersionIdentityInput {
  operation: ChatOperation;
  userMessageId: string;
  source?: Pick<StoredMessage, 'id' | 'kind' | 'versionGroupId' | 'version' | 'replyToMessageId' | 'text'>;
  messages: ReadonlyArray<Pick<StoredMessage, 'id' | 'kind' | 'versionGroupId' | 'version' | 'replyToMessageId' | 'text'>>;
}

/**
 * Derives a message family without mutating history. Callers validate source
 * kind and regenerate prompt separately; this function deliberately has no
 * store, clock, or transport dependency.
 */
export function deriveVersionIdentity(input: VersionIdentityInput): VersionIdentity {
  const source = input.source;
  const versionSource = input.operation === 'regenerate' && source
    ? findRegenerateUser(source, input.messages) || source
    : source;
  const versionGroupId = versionSource?.versionGroupId || versionSource?.id || input.userMessageId;
  const existingVersion = input.messages.reduce((maximum, message) => message.versionGroupId === versionGroupId
    ? Math.max(maximum, message.version || 1)
    : maximum, 0);
  return { versionGroupId, version: existingVersion + 1 };
}

function findRegenerateUser(
  source: NonNullable<VersionIdentityInput['source']>,
  messages: VersionIdentityInput['messages'],
): VersionIdentityInput['source'] | undefined {
  if (source.replyToMessageId) return messages.find(message => message.id === source.replyToMessageId && message.kind === 'user');
  const sourceIndex = messages.findIndex(message => message.id === source.id);
  if (sourceIndex < 0) return undefined;
  return [...messages.slice(0, sourceIndex)].reverse().find(message => message.kind === 'user');
}
