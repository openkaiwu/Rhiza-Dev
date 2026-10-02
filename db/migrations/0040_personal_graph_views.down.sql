DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM graph_layouts WHERE owner_scope->>'scopeType'='user') THEN
    RAISE EXCEPTION 'Personal graph state must be preserved; roll back only to a schema-compatible reader';
  END IF;
END $$;
ALTER TABLE graph_layouts DROP CONSTRAINT personal_graph_view_owner;
DROP INDEX personal_graph_view_identity;
ALTER TABLE graph_layouts DROP COLUMN updated_at, DROP COLUMN view_state, DROP COLUMN revision;
