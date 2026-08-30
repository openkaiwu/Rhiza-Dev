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
export const legacyActorRef: ActorRef = { actorType: 'human', actorId: '00000000-0000-4000-8000-000000000002' };
export const legacyScopeRef: ScopeRef = { scopeType: 'workspace', scopeId: '00000000-0000-4000-8000-000000000001' };

export interface RequestIdentity {
  schemaVersion: '1.0.0';
  workspaceId: string;
  actor: ActorRef;
  scope: ScopeRef;
  correlationId?: string;
}
