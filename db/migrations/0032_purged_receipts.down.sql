DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM command_receipts WHERE purged_at IS NOT NULL) THEN
    RAISE EXCEPTION 'purged receipt keys cannot be restored';
  END IF;
END $$;
ALTER TABLE command_receipts DROP CONSTRAINT command_receipts_purged_payload_check;
ALTER TABLE command_receipts DROP COLUMN purged_at;
ALTER TABLE purge_key_references DROP CONSTRAINT purge_key_references_content_family_check;
ALTER TABLE purge_key_references ADD CONSTRAINT purge_key_references_content_family_check
  CHECK (content_family IN ('node', 'message', 'manifest', 'segment', 'anchor', 'edge', 'context-item', 'journal'));
