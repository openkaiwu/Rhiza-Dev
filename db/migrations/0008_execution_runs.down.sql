-- Execution history is durable user data; rollback requires an explicit export/recovery procedure.
DO $$ BEGIN RAISE EXCEPTION 'ExecutionRun downgrade requires a verified backup; automatic destructive rollback is disabled'; END $$;
