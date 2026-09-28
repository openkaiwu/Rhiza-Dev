ALTER TABLE execution_runs ADD COLUMN purged_at timestamptz;
ALTER TABLE execution_runs ADD COLUMN purge_id uuid REFERENCES purge_checkpoints(purge_id) ON DELETE RESTRICT;
ALTER TABLE execution_runs ADD CONSTRAINT execution_run_purge_valid CHECK (
  (purged_at IS NULL AND purge_id IS NULL)
  OR (purged_at IS NOT NULL AND purge_id IS NOT NULL AND input_content_ref IS NULL
    AND input_envelope = '{"purged":true}'::jsonb AND record->'input' = '{"purged":true}'::jsonb)
);

CREATE OR REPLACE FUNCTION protect_execution_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'ExecutionRun history is immutable'; END IF;
  IF OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL
    AND current_setting('rhiza.purge_execution_run', true) = 'on'
    AND OLD.status IN ('completed','failed','canceled','interrupted')
    AND NEW.input_envelope = '{"purged":true}'::jsonb AND NEW.input_content_ref IS NULL
    AND ROW(OLD.run_id,OLD.workspace_id,OLD.command_id,OLD.node_id,OLD.status,OLD.attempt,OLD.parent_run_ref,OLD.input_hash,OLD.model_spec_ref,OLD.provider_endpoint_ref)
      IS NOT DISTINCT FROM ROW(NEW.run_id,NEW.workspace_id,NEW.command_id,NEW.node_id,NEW.status,NEW.attempt,NEW.parent_run_ref,NEW.input_hash,NEW.model_spec_ref,NEW.provider_endpoint_ref)
    AND NEW.record = jsonb_build_object('id',OLD.run_id,'workspaceId',OLD.workspace_id,'nodeId',OLD.node_id,
      'commandId',OLD.command_id,'status',OLD.status,'attempt',OLD.attempt,'input',jsonb_build_object('purged',true),
      'inputHash',OLD.input_hash,'createdAt',OLD.record->'createdAt','telemetry',jsonb_build_object('traceCount',0))
    AND EXISTS (SELECT 1 FROM purge_checkpoints p WHERE p.purge_id=NEW.purge_id
      AND p.workspace_id=OLD.workspace_id AND OLD.node_id IN (p.node_id::text, 'temp:' || p.node_id::text)
      AND p.phase='pending')
    THEN RETURN NEW;
  END IF;
  IF OLD.purged_at IS NOT NULL OR NEW.purged_at IS NOT NULL OR OLD.purge_id IS DISTINCT FROM NEW.purge_id
    THEN RAISE EXCEPTION 'Purged ExecutionRun history is immutable'; END IF;
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
  IF OLD.input_content_ref IS DISTINCT FROM NEW.input_content_ref
    AND NOT (OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL AND NEW.input_content_ref IS NULL
      AND current_setting('rhiza.purge_execution_run', true) = 'on') THEN
    RAISE EXCEPTION 'ExecutionRun content reference is immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION rhiza_context_manifest_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'rhiza_context_manifests are immutable'; END IF;
  IF current_setting('rhiza.purge_context_manifest_delete', true) IS DISTINCT FROM 'on'
    OR (OLD.manifest->>'schemaVersion' = '1.0.0' AND NOT EXISTS (
      SELECT 1 FROM purge_checkpoints p WHERE p.workspace_id=OLD.project_id
        AND p.node_id=OLD.node_id AND p.phase='pending')) THEN
    RAISE EXCEPTION 'rhiza_context_manifests may only be deleted by an authorized purge';
  END IF;
  RETURN OLD;
END;
$$;

CREATE FUNCTION protect_purged_run_trace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM execution_runs WHERE run_id=NEW.run_id AND purged_at IS NOT NULL FOR SHARE) THEN
    RAISE EXCEPTION 'Purged ExecutionRun trace is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER execution_run_trace_purge_guard BEFORE INSERT OR UPDATE ON execution_run_traces
  FOR EACH ROW EXECUTE FUNCTION protect_purged_run_trace();
