-- Application facts remain encrypted in the append-only Journal. This index holds identities only.
CREATE INDEX workspace_events_collaboration_latest ON workspace_events(workspace_id,aggregate_id,sequence DESC)
  WHERE event_type='collaboration.changed';
CREATE TABLE collaboration_run_links (
  workspace_id uuid NOT NULL REFERENCES workspaces(workspace_id),
  run_id uuid NOT NULL,
  collaboration_id uuid NOT NULL,
  PRIMARY KEY(workspace_id,run_id)
);
