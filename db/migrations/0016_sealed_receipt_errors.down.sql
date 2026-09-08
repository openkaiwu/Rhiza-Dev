DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM command_receipts WHERE error_content_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot remove sealed error references before restoring receipt errors';
  END IF;
END $$;
ALTER TABLE command_receipts DROP CONSTRAINT command_receipt_sealed_error_valid;
ALTER TABLE command_receipts DROP COLUMN error_content_ref;
