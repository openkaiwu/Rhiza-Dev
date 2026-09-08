DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM rhiza_messages WHERE content_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot remove sealed message references before restoring content';
  END IF;
END $$;
ALTER TABLE rhiza_messages DROP CONSTRAINT message_sealed_content_valid;
ALTER TABLE rhiza_messages DROP COLUMN content_ref;
