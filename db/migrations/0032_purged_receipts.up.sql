ALTER TABLE command_receipts ADD COLUMN purged_at timestamptz;
ALTER TABLE command_receipts ADD CONSTRAINT command_receipts_purged_payload_check CHECK (
  purged_at IS NULL OR (
    (status = 'committed' AND result IS NULL)
    OR (status = 'rejected' AND result IS NULL AND error = '{"sealed":true}'::jsonb)
  )
);

ALTER TABLE purge_key_references DROP CONSTRAINT purge_key_references_content_family_check;
ALTER TABLE purge_key_references ADD CONSTRAINT purge_key_references_content_family_check
  CHECK (content_family IN ('node', 'message', 'manifest', 'segment', 'anchor', 'edge', 'context-item', 'journal', 'receipt-result', 'receipt-error'));
