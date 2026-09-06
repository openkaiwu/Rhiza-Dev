DROP TRIGGER rhiza_context_manifest_validate ON rhiza_context_manifests;
DROP FUNCTION rhiza_validate_frozen_context();
CREATE OR REPLACE FUNCTION rhiza_context_manifest_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'rhiza_context_manifests are immutable'; END IF;
  IF current_setting('rhiza.purge_context_manifest_delete', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'rhiza_context_manifests may only be deleted by an authorized purge';
  END IF;
  RETURN OLD;
END;
$$;
-- A downgrade with context-source facts must fail rather than discard immutable history.
ALTER TABLE rhiza_resources DROP CONSTRAINT rhiza_resources_kind_check;
ALTER TABLE rhiza_resources ADD CONSTRAINT rhiza_resources_kind_check CHECK (kind IN ('attachment'));
