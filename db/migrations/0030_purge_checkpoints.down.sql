DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM purge_checkpoints) THEN
    RAISE EXCEPTION 'Cannot remove durable purge history after a purge has started';
  END IF;
END $$;

DROP TABLE purge_key_references;
DROP TABLE purge_checkpoints;
