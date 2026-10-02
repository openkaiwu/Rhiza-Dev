-- Operational metadata only. Bodies and resource bytes stay in the existing encrypted archive store.
CREATE TABLE managed_backups (
  workspace_id uuid NOT NULL REFERENCES workspaces(workspace_id),
  backup_id text NOT NULL,
  owner_id uuid NOT NULL REFERENCES users(user_id),
  status text NOT NULL CHECK (status IN ('running','ready','failed','interrupted','purged')),
  purge_generation bigint NOT NULL CHECK (purge_generation >= 0),
  archive_digest text CHECK (archive_digest ~ '^[a-f0-9]{64}$'),
  state_digest text CHECK (state_digest ~ '^[a-f0-9]{64}$'),
  size_bytes bigint CHECK (size_bytes > 0),
  retry_of text,
  error_code text CHECK (error_code IN ('BACKUP_FAILED','BACKUP_LOCATION_UNAVAILABLE','BACKUP_INTERRUPTED','BACKUP_PURGED')),
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY(workspace_id,backup_id),
  CHECK ((archive_digest IS NULL) = (state_digest IS NULL)),
  CHECK ((archive_digest IS NULL) = (size_bytes IS NULL)),
  CHECK (status <> 'ready' OR (archive_digest IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX managed_backups_digest ON managed_backups(archive_digest) WHERE archive_digest IS NOT NULL;
CREATE INDEX managed_backups_owner_recent ON managed_backups(workspace_id,owner_id,started_at DESC);
