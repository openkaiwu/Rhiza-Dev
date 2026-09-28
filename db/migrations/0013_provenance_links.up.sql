CREATE TABLE provenance_links (
  workspace_id uuid NOT NULL REFERENCES rhiza_projects(id),
  output_ref text NOT NULL,
  provenance_id text NOT NULL,
  record jsonb NOT NULL,
  PRIMARY KEY (workspace_id, output_ref),
  UNIQUE (provenance_id),
  CHECK (record->>'schemaVersion' = '1.0.0'),
  CHECK (record->>'workspaceId' = workspace_id::text),
  CHECK (record->>'outputRef' = output_ref),
  CHECK (record->>'id' = provenance_id)
);
