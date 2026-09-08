DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM rhiza_anchors WHERE content_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot remove sealed anchor references before restoring content';
  END IF;
END $$;
ALTER TABLE rhiza_anchors DROP CONSTRAINT anchor_sealed_content_valid;
ALTER TABLE rhiza_anchors DROP COLUMN content_ref;
