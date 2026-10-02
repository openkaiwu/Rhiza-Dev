-- Optional metadata: existing aggregates and portable history keep their original checksums.
ALTER TABLE rhiza_nodes ADD COLUMN preferred_model_id text;
ALTER TABLE rhiza_segments ADD COLUMN status text CHECK (status IS NULL OR status='archived');
CREATE INDEX execution_runs_command_workspace ON execution_runs(workspace_id,command_id) WHERE purged_at IS NULL;
CREATE INDEX graph_relations_source_bounded ON graph_relations(workspace_id,projection_version,source_type,source_id,relation_id);
CREATE INDEX graph_relations_target_bounded ON graph_relations(workspace_id,projection_version,target_type,target_id,relation_id);
CREATE INDEX graph_relations_source_identity ON graph_relations(workspace_id,projection_version,(source_type || chr(31) || source_id),relation_id);
CREATE INDEX graph_relations_target_identity ON graph_relations(workspace_id,projection_version,(target_type || chr(31) || target_id),relation_id);
