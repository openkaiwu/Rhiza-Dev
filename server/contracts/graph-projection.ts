export interface ObjectRef {
  workspaceId: string;
  objectType: string;
  objectId: string;
  versionId?: string;
}
export type ObjectLifecycle = 'active' | 'archived' | 'tombstoned';
export interface ProjectedObject {
  ref: ObjectRef; revision: number; lifecycle: ObjectLifecycle; title: string; summary: string; kind: string; status: string;
  createdAt: string; updatedAt: string; layout?: { x: number; y: number; collapsed?: boolean };
}
export interface ProjectedRelation {
  id: string; source: ObjectRef; target: ObjectRef; relationType: string; lifecycle: 'active' | 'retracted'; label: string; createdAt: string;
}
export interface WorkspaceGraphProjection {
  workspaceId: string; version: 'graph-v1'; checkpoint: number; checksum: string; objects: ProjectedObject[]; relations: ProjectedRelation[];
}
export interface GraphQueryResult {
  version: string; checkpoint: number; objects: ProjectedObject[]; relations: ProjectedRelation[]; nextCursor?: string;
}
export interface GraphNeighborhoodInput { root?: ObjectRef; depth?: number; nodeLimit?: number; edgeLimit?: number; cursor?: string; objectTypes?: string[] }
export interface GraphPathInput { from: ObjectRef; to: ObjectRef; nodeLimit?: number }
export interface GraphTreeInput { root: ObjectRef; depth?: number; nodeLimit?: number }
export interface GraphChangesInput { cursor: number; limit?: number }
export interface GraphChangesResult { version: string; checkpoint: number; resetRequired: boolean; objects: ProjectedObject[]; relations: ProjectedRelation[] }
