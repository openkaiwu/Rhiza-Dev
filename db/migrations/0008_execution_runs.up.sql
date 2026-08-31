CREATE TABLE execution_runs (
  run_id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(workspace_id),
  command_id text NOT NULL,
  node_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('created','dispatching','running','completed','failed','canceled','interrupted')),
  attempt integer NOT NULL CHECK (attempt = 1),
  parent_run_ref text,
  input_envelope jsonb NOT NULL,
  input_hash text NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  model_spec_ref text NOT NULL,
  provider_endpoint_ref text NOT NULL,
  record jsonb NOT NULL,
  CHECK (record->'input' = input_envelope AND record->>'inputHash' = input_hash AND record->>'id' = run_id AND record->>'workspaceId' = workspace_id::text AND record->>'status' = status),
  UNIQUE (workspace_id, command_id),
  UNIQUE (workspace_id, run_id),
  FOREIGN KEY (workspace_id,parent_run_ref) REFERENCES execution_runs(workspace_id,run_id)
);
CREATE INDEX execution_runs_workspace_status ON execution_runs(workspace_id,status);
CREATE TABLE execution_run_traces (
  run_id text NOT NULL REFERENCES execution_runs(run_id),
  attempt integer NOT NULL,
  sequence integer NOT NULL,
  record jsonb NOT NULL,
  PRIMARY KEY(run_id,attempt,sequence)
);
CREATE FUNCTION protect_execution_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'ExecutionRun history is immutable'; END IF;
  IF ROW(OLD.run_id,OLD.workspace_id,OLD.command_id,OLD.node_id,OLD.attempt,OLD.parent_run_ref,OLD.input_envelope,OLD.input_hash,OLD.model_spec_ref,OLD.provider_endpoint_ref)
    IS DISTINCT FROM ROW(NEW.run_id,NEW.workspace_id,NEW.command_id,NEW.node_id,NEW.attempt,NEW.parent_run_ref,NEW.input_envelope,NEW.input_hash,NEW.model_spec_ref,NEW.provider_endpoint_ref)
    THEN RAISE EXCEPTION 'ExecutionRun input and lineage are immutable'; END IF;
  IF (OLD.record - ARRAY['status','dispatchingAt','runningAt','terminalAt','cancelRequestedAt','error','telemetry']) IS DISTINCT FROM (NEW.record - ARRAY['status','dispatchingAt','runningAt','terminalAt','cancelRequestedAt','error','telemetry']) THEN RAISE EXCEPTION 'ExecutionRun record identity is immutable'; END IF;
  IF OLD.status IN ('completed','failed','canceled','interrupted') THEN RAISE EXCEPTION 'ExecutionRun terminal state is immutable'; END IF;
  IF NOT ((OLD.status='created' AND NEW.status='dispatching') OR (OLD.status='dispatching' AND NEW.status='running')
    OR (OLD.status='running' AND NEW.status='completed') OR NEW.status IN ('failed','canceled','interrupted'))
    THEN RAISE EXCEPTION 'Invalid ExecutionRun transition'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER execution_run_history BEFORE UPDATE OR DELETE ON execution_runs FOR EACH ROW EXECUTE FUNCTION protect_execution_run();
CREATE TRIGGER execution_run_no_truncate BEFORE TRUNCATE ON execution_runs FOR EACH STATEMENT EXECUTE FUNCTION protect_execution_run();
