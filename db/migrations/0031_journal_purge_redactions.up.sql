CREATE TABLE journal_payload_redactions (
  event_id uuid PRIMARY KEY REFERENCES workspace_events(event_id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES rhiza_projects(id) ON DELETE CASCADE,
  purge_id uuid NOT NULL REFERENCES purge_checkpoints(purge_id) ON DELETE RESTRICT,
  content_ref jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE purge_key_references DROP CONSTRAINT purge_key_references_content_family_check;
ALTER TABLE purge_key_references ADD CONSTRAINT purge_key_references_content_family_check
  CHECK (content_family IN ('node', 'message', 'manifest', 'segment', 'anchor', 'edge', 'context-item', 'journal'));
