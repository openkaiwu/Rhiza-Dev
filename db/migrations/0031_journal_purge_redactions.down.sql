DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM journal_payload_redactions) THEN
    RAISE EXCEPTION 'journal Purge redactions cannot be rolled back';
  END IF;
END $$;
DROP TABLE journal_payload_redactions;
ALTER TABLE purge_key_references DROP CONSTRAINT purge_key_references_content_family_check;
ALTER TABLE purge_key_references ADD CONSTRAINT purge_key_references_content_family_check
  CHECK (content_family IN ('node', 'message', 'manifest', 'segment', 'anchor', 'edge', 'context-item'));
