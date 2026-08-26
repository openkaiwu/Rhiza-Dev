/** Stable identity references carried by every application request. */
export interface ActorRef {
  actorType: 'human' | 'system' | 'executor' | 'extension';
  actorId: string;
}

export interface ScopeRef {
  scopeType: 'user' | 'workspace' | 'conversation' | 'run';
  scopeId: string;
}

/**
 * Compatibility references used until M03 installs authenticated workspace
 * resolution. They are explicit so callers cannot silently omit tenancy.
 */
export const legacyActorRef: ActorRef = { actorType: 'human', actorId: 'legacy-local' };
export const legacyScopeRef: ScopeRef = { scopeType: 'workspace', scopeId: 'legacy-default-workspace' };

export interface RequestIdentity {
  schemaVersion: '1.0.0';
  workspaceId: string;
  actor: ActorRef;
  scope: ScopeRef;
  correlationId?: string;
}
