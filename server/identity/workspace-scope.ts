import type { ActorRef, ScopeRef } from '../contracts/references';
export const LOCAL_USER_ID = '00000000-0000-4000-8000-000000000002';
export const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

/** The M03 authorization seam: only membership and workspace scope are decided here. */
export function assertWorkspaceScope(actor: ActorRef, scope: ScopeRef, workspaceId: string, member: boolean): void {
  if (scope.scopeType !== 'workspace' || scope.scopeId !== workspaceId) throw Object.assign(new Error('Workspace scope does not match request workspace'), { code: 'WORKSPACE_SCOPE_MISMATCH', status: 403 });
  if (actor.actorType !== 'human' || !actor.actorId || !member) throw Object.assign(new Error('Actor is not a workspace member'), { code: 'WORKSPACE_ACCESS_DENIED', status: 403 });
}
