import { createHash } from 'node:crypto';
import type { WorkspaceData } from '../domain';
import { workspaceSemanticSnapshot } from '../domain-journal';

export function semanticChecksum(workspace: WorkspaceData): string {
  return semanticStateChecksum(workspaceSemanticSnapshot(workspace));
}

export function semanticStateChecksum(state: Record<string, unknown>): string {
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
    return value;
  };
  return createHash('sha256').update(JSON.stringify(canonicalize(state))).digest('hex');
}
