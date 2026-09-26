CREATE TABLE purge_checkpoints (
  purge_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES rhiza_projects(id) ON DELETE RESTRICT,
  node_id uuid NOT NULL,
  phase text NOT NULL DEFAULT 'pending' CHECK (phase IN ('pending', 'revoked')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK ((phase = 'pending' AND revoked_at IS NULL) OR (phase = 'revoked' AND revoked_at IS NOT NULL))
);

CREATE INDEX purge_checkpoints_pending_idx
  ON purge_checkpoints (created_at, purge_id)
  WHERE phase = 'pending';

CREATE TABLE purge_key_references (
  purge_id uuid NOT NULL REFERENCES purge_checkpoints(purge_id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  content_family text NOT NULL CHECK (content_family IN ('node', 'message', 'manifest', 'segment', 'anchor', 'edge', 'context-item')),
  entity_id text NOT NULL CHECK (entity_id <> ''),
  content_ref jsonb NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (purge_id, ordinal)
);

