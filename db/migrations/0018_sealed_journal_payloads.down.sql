DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM workspace_events WHERE payload_content_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot remove sealed Journal references before restoring payloads';
  END IF;
END $$;
ALTER TABLE workspace_events DROP CONSTRAINT journal_sealed_payload_valid;
ALTER TABLE workspace_events DROP COLUMN payload_content_ref;
