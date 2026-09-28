DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM rhiza_attachments WHERE content_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot remove sealed attachment references before restoring content';
  END IF;
END $$;
ALTER TABLE rhiza_attachments DROP CONSTRAINT attachment_sealed_content_valid;
ALTER TABLE rhiza_attachments DROP COLUMN content_ref;
