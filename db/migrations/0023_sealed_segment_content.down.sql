DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM rhiza_segments WHERE content_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot remove sealed segment references before restoring content';
  END IF;
END $$;
ALTER TABLE rhiza_segments DROP CONSTRAINT segment_sealed_content_valid;
ALTER TABLE rhiza_segments DROP COLUMN content_ref;
