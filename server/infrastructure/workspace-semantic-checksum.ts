import { createHash } from 'node:crypto';
import { canonicalJson } from '../domain/canonical-json';
import type { WorkspaceData } from '../domain';
import { workspaceSemanticSnapshot } from '../domain-journal';

export function semanticChecksum(workspace: WorkspaceData): string {
  return semanticStateChecksum(workspaceSemanticSnapshot(workspace));
}

export function semanticStateChecksum(state: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(state)).digest('hex');
}
