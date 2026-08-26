CREATE FUNCTION rhiza_context_manifest_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'rhiza_context_manifests are immutable';
  END IF;
  IF current_setting('rhiza.purge_context_manifest_delete', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'rhiza_context_manifests may only be deleted by an authorized purge';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER rhiza_context_manifests_immutable
BEFORE UPDATE OR DELETE ON rhiza_context_manifests
FOR EACH ROW EXECUTE FUNCTION rhiza_context_manifest_immutable();
