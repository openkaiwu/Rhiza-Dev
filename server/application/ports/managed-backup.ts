import type { CommandFactContext } from '../../domain-journal';
import type { BundleExport, PortableWorkspaceFacts } from './portable-workspace';

import type { ManagedBackup, ManagedBackupList } from '../../contracts/managed-backup';
export type { ManagedBackup, ManagedBackupList } from '../../contracts/managed-backup';
export interface ManagedBackupLifecyclePort {
  begin(context: CommandFactContext, retryOf?: string): Promise<{ record: ManagedBackup; facts?: PortableWorkspaceFacts }>;
  register(context: CommandFactContext, archive: { archiveDigest: string; stateDigest: string; sizeBytes: number }): Promise<void>;
  publish(context: CommandFactContext, retain: () => Promise<void>): Promise<ManagedBackup>;
  fail(context: CommandFactContext, code: string): Promise<ManagedBackup>;
  list(ownerId: string): Promise<ManagedBackupList>;
  download(ownerId: string, backupId: string): Promise<BundleExport>;
}
