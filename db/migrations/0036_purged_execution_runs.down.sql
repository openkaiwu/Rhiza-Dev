DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM execution_runs WHERE purged_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Purged ExecutionRun input cannot be restored';
  END IF;
END $$;

DROP TRIGGER execution_run_trace_purge_guard ON execution_run_traces;
DROP FUNCTION protect_purged_run_trace();

CREATE OR REPLACE FUNCTION rhiza_context_manifest_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR OLD.manifest->>'schemaVersion' = '1.0.0' THEN
    RAISE EXCEPTION 'rhiza_context_manifests are immutable';
  END IF;
  IF current_setting('rhiza.purge_context_manifest_delete', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'rhiza_context_manifests may only be deleted by an authorized purge';
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION protect_execution_run() RETURNS trigger LANGUAGE plpgsql AS $$
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

CREATE OR REPLACE FUNCTION protect_execution_run_content_ref() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.input_content_ref IS DISTINCT FROM NEW.input_content_ref THEN
    RAISE EXCEPTION 'ExecutionRun content reference is immutable';
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE execution_runs DROP CONSTRAINT execution_run_purge_valid;
ALTER TABLE execution_runs DROP COLUMN purge_id;
ALTER TABLE execution_runs DROP COLUMN purged_at;
