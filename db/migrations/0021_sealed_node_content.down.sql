DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM rhiza_nodes WHERE content_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot remove sealed node references before restoring content';
  END IF;
END $$;
ALTER TABLE rhiza_nodes DROP CONSTRAINT node_sealed_content_valid;
ALTER TABLE rhiza_nodes DROP COLUMN content_ref;
