DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM managed_backups) THEN
    RAISE EXCEPTION 'Managed backup inventory must be preserved; roll back only to a schema-compatible reader';
  END IF;
END $$;
DROP TABLE managed_backups;
