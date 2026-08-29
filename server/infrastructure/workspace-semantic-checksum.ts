import { createHash } from 'node:crypto';
import type { WorkspaceData } from '../domain';
import { workspaceSemanticSnapshot } from '../domain-journal';

export function semanticChecksum(workspace: WorkspaceData): string {
  return createHash('sha256').update(JSON.stringify(workspaceSemanticSnapshot(workspace))).digest('hex');
}
