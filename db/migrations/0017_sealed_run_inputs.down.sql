DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM execution_runs WHERE input_content_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot remove sealed Run references before restoring inputs';
  END IF;
END $$;
DROP TRIGGER execution_run_content_ref_immutable ON execution_runs;
DROP FUNCTION protect_execution_run_content_ref();
ALTER TABLE execution_runs DROP CONSTRAINT execution_run_sealed_input_valid;
ALTER TABLE execution_runs DROP COLUMN input_content_ref;
