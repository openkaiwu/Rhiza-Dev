DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM rhiza_resources WHERE content_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot remove sealed resource references before restoring content';
  END IF;
END $$;
ALTER TABLE rhiza_resources DROP CONSTRAINT resource_sealed_content_valid;
ALTER TABLE rhiza_resources DROP COLUMN content_ref;
