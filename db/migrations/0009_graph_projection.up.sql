CREATE TABLE workspace_objects (
  workspace_id uuid NOT NULL REFERENCES rhiza_projects(id) ON DELETE CASCADE,
  projection_version text NOT NULL DEFAULT 'graph-v1',
  object_type text NOT NULL CHECK (char_length(object_type) BETWEEN 1 AND 80),
  object_id text NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  lifecycle_status text NOT NULL CHECK (lifecycle_status IN ('active','archived','tombstoned')),
  title text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT '',
  object_status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, projection_version, object_type, object_id)
);

CREATE TABLE graph_relations (
  workspace_id uuid NOT NULL REFERENCES rhiza_projects(id) ON DELETE CASCADE,
  projection_version text NOT NULL DEFAULT 'graph-v1',
  relation_id text NOT NULL,
  source_type text NOT NULL,
  source_id text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  relation_type text NOT NULL,
  lifecycle_status text NOT NULL CHECK (lifecycle_status IN ('active','retracted')),
  label text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, projection_version, relation_id)
);

CREATE TABLE graph_layouts (
  workspace_id uuid NOT NULL REFERENCES rhiza_projects(id) ON DELETE CASCADE,
  layout_id text NOT NULL,
  view_type text NOT NULL DEFAULT 'conversation',
  algorithm_version text NOT NULL DEFAULT 'manual-v1',
  owner_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (workspace_id, layout_id)
);

CREATE TABLE graph_layout_nodes (
  workspace_id uuid NOT NULL,
  layout_id text NOT NULL,
  object_type text NOT NULL,
  object_id text NOT NULL,
  x integer NOT NULL,
  y integer NOT NULL,
  collapsed boolean NOT NULL DEFAULT false,
  style_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (workspace_id, layout_id, object_type, object_id),
  FOREIGN KEY (workspace_id, layout_id) REFERENCES graph_layouts(workspace_id, layout_id) ON DELETE CASCADE
);

CREATE TABLE projection_checkpoints (
  workspace_id uuid NOT NULL REFERENCES rhiza_projects(id) ON DELETE CASCADE,
  projection_name text NOT NULL,
  projection_version text NOT NULL,
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  semantic_checksum text NOT NULL CHECK (semantic_checksum ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, projection_name, projection_version)
);

CREATE TABLE projection_aliases (
  workspace_id uuid NOT NULL REFERENCES rhiza_projects(id) ON DELETE CASCADE,
  projection_name text NOT NULL,
  active_version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, projection_name)
);

CREATE INDEX workspace_objects_lookup_idx ON workspace_objects(workspace_id, projection_version, lifecycle_status, object_type, object_id);
CREATE INDEX graph_relations_source_idx ON graph_relations(workspace_id, projection_version, source_type, source_id) WHERE lifecycle_status='active';
CREATE INDEX graph_relations_target_idx ON graph_relations(workspace_id, projection_version, target_type, target_id) WHERE lifecycle_status='active';

INSERT INTO graph_layouts (workspace_id, layout_id, owner_scope)
SELECT workspace_id, 'default', jsonb_build_object('scopeType','workspace','scopeId',workspace_id)
FROM workspaces ON CONFLICT DO NOTHING;

INSERT INTO graph_layout_nodes (workspace_id, layout_id, object_type, object_id, x, y)
SELECT project_id, 'default', 'conversation', id::text, position_x, position_y FROM rhiza_nodes
ON CONFLICT DO NOTHING;
