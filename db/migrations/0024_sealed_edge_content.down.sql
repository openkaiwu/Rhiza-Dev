DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM rhiza_edges WHERE content_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot remove sealed edge references before restoring content';
  END IF;
END $$;
ALTER TABLE rhiza_edges DROP CONSTRAINT edge_sealed_content_valid;
ALTER TABLE rhiza_edges DROP COLUMN content_ref;
