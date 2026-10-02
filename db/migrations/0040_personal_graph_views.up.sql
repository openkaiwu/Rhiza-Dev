ALTER TABLE graph_layouts ADD COLUMN revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0);
ALTER TABLE graph_layouts ADD COLUMN view_state jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(view_state)='object');
ALTER TABLE graph_layouts ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX personal_graph_view_identity ON graph_layouts(workspace_id,view_type,(owner_scope->>'scopeId'))
  WHERE owner_scope->>'scopeType'='user';
ALTER TABLE graph_layouts ADD CONSTRAINT personal_graph_view_owner CHECK (
  layout_id NOT LIKE 'personal-v1:%' OR (
    owner_scope->>'scopeType'='user' AND jsonb_typeof(owner_scope->'scopeId')='string'
    AND length(owner_scope->>'scopeId') BETWEEN 1 AND 200
    AND owner_scope - ARRAY['scopeType','scopeId']='{}'::jsonb
    AND view_type ~ '^[a-z][a-z0-9-]{0,63}$'
  ) IS TRUE
);
