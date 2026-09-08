DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM command_receipts WHERE result_content_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot remove sealed receipt references before restoring receipt results';
  END IF;
END $$;
ALTER TABLE command_receipts DROP CONSTRAINT command_receipt_sealed_result_valid;
ALTER TABLE command_receipts DROP COLUMN result_content_ref;
