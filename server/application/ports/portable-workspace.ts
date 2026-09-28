import type { WorkspaceData, ProvenanceLink } from '../../domain';
import type { ExecutionRun } from '../../execution-runtime/run';
import type { DomainEventEnvelope } from '../../domain-journal';
import type { WorkspaceRecord } from '../../contracts/application';
import type { BundleExport } from '../../domain/portable-bundle';
export type { BundleExport } from '../../domain/portable-bundle';

/** A single committed view; never assemble these collections using independent live reads. */
export interface PortableWorkspaceFacts {
  workspace: WorkspaceData;
  directory: WorkspaceRecord;
  members: Array<{ userId: string; role: 'owner' | 'member' }>;
  runs: ExecutionRun[];
  provenance: ProvenanceLink[];
  journal: DomainEventEnvelope[];
}

export interface PortableBundlePort {
  export(facts: PortableWorkspaceFacts): Promise<BundleExport>;
}
