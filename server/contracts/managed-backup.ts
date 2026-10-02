export interface ManagedBackup {
  backupId: string;
  workspaceId: string;
  ownerId: string;
  status: 'running' | 'ready' | 'failed' | 'interrupted' | 'purged';
  location: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  archiveDigest?: string;
  stateDigest?: string;
  sizeBytes?: number;
  retryOf?: string;
  errorCode?: string;
}
export interface ManagedBackupList {
  backups: ManagedBackup[];
  reminder: { due: boolean; nextAt: string | null; intervalDays: 7 };
}
