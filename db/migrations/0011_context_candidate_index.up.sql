CREATE TABLE context_candidate_heads (
  workspace_id uuid PRIMARY KEY REFERENCES rhiza_projects(id) ON DELETE CASCADE,
  index_version text NOT NULL,
  revision bigint NOT NULL DEFAULT 1
);

CREATE TABLE context_candidate_index (
  workspace_id uuid NOT NULL REFERENCES rhiza_projects(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_id text NOT NULL,
  source_node_id text,
  attachment_id text,
  source_digest text NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  resource_version_id text REFERENCES rhiza_resource_versions(resource_version_id),
  resource_digest text,
  terms text[] NOT NULL,
  candidate jsonb NOT NULL,
  PRIMARY KEY (workspace_id, source_type, source_id)
);
CREATE INDEX context_candidates_terms_idx ON context_candidate_index USING gin (terms);
CREATE INDEX context_candidates_node_idx ON context_candidate_index(workspace_id, source_node_id);
CREATE INDEX context_candidates_attachment_idx ON context_candidate_index(workspace_id, attachment_id);
