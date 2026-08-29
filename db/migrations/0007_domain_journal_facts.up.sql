CREATE TABLE workspace_event_heads (
  workspace_id uuid PRIMARY KEY REFERENCES rhiza_projects(id) ON DELETE CASCADE,
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace_events (
  event_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES rhiza_projects(id) ON DELETE CASCADE,
  sequence bigint NOT NULL CHECK (sequence >= 1),
  event_type text NOT NULL CHECK (event_type !~ '^workflow\\.'),
  schema_version text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  actor jsonb NOT NULL,
  scope jsonb NOT NULL,
  command_id text NOT NULL,
  correlation_id text,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, sequence)
);

CREATE TABLE command_receipts (
  workspace_id uuid NOT NULL REFERENCES rhiza_projects(id) ON DELETE CASCADE,
  command_id text NOT NULL,
  command_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('committed', 'rejected')),
  first_sequence bigint,
  last_sequence bigint,
  result jsonb,
  error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, command_id),
  CHECK ((status = 'committed' AND error IS NULL) OR (status = 'rejected' AND error IS NOT NULL)),
  CHECK ((first_sequence IS NULL AND last_sequence IS NULL) OR (first_sequence >= 1 AND last_sequence >= first_sequence))
);

CREATE INDEX workspace_events_workspace_time_idx ON workspace_events(workspace_id, occurred_at DESC, sequence DESC);
CREATE INDEX workspace_events_aggregate_idx ON workspace_events(workspace_id, aggregate_type, aggregate_id, sequence);
CREATE INDEX command_receipts_status_idx ON command_receipts(workspace_id, status, created_at DESC);

CREATE FUNCTION rhiza_reject_workspace_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'workspace_events are append-only';
END;
$$;

CREATE TRIGGER workspace_events_append_only
BEFORE UPDATE OR DELETE ON workspace_events
FOR EACH ROW EXECUTE FUNCTION rhiza_reject_workspace_event_mutation();
