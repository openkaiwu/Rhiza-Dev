DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM purge_key_references WHERE content_family = 'import-archive') THEN
    RAISE EXCEPTION 'purged import archive content cannot be restored';
  END IF;
END $$;

ALTER TABLE purge_key_references DROP CONSTRAINT purge_key_references_content_family_check;
ALTER TABLE purge_key_references ADD CONSTRAINT purge_key_references_content_family_check
  CHECK (content_family IN ('node', 'message', 'manifest', 'segment', 'anchor', 'edge', 'context-item', 'journal', 'receipt-result', 'receipt-error', 'resource-version', 'resource', 'attachment', 'file-chunk', 'run-input'));
