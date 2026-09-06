ALTER TABLE rhiza_resources DROP CONSTRAINT rhiza_resources_kind_check;
ALTER TABLE rhiza_resources ADD CONSTRAINT rhiza_resources_kind_check CHECK (kind IN ('attachment','context-source'));

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

CREATE FUNCTION rhiza_validate_frozen_context()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item jsonb;
BEGIN
  IF NEW.manifest->>'schemaVersion' = '1.0.0' THEN
    IF jsonb_typeof(NEW.manifest->'contextItems') IS DISTINCT FROM 'array'
      OR coalesce(NEW.manifest->'versions'->>'planner','') = ''
      OR coalesce(NEW.manifest->'versions'->>'compiler','') = ''
      OR coalesce(NEW.manifest->'versions'->>'tokenizer','') = ''
      OR coalesce(NEW.manifest->'versions'->>'selectionPolicy','') = ''
      OR jsonb_typeof(NEW.manifest->'versions'->'contributors') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Manifest v1 requires items and runtime versions';
    END IF;
    FOR item IN SELECT * FROM jsonb_array_elements(NEW.manifest->'contextItems') LOOP
      IF coalesce(item->>'contributorVersion','') = '' OR coalesce(item->>'reason','') = ''
        OR coalesce(item->>'selectionMode','') = '' OR jsonb_typeof(item->'priority') IS DISTINCT FROM 'number'
        OR NOT EXISTS (SELECT 1 FROM rhiza_resource_versions rv JOIN rhiza_resources r ON r.resource_id=rv.resource_id
          WHERE rv.resource_version_id=item->>'resourceVersionId' AND rv.digest=item->>'digest'
            AND r.resource_id=item->>'resourceId' AND r.workspace_id=NEW.project_id) THEN
        RAISE EXCEPTION 'Manifest v1 requires an existing scoped ResourceVersion and selection evidence';
      END IF;
      IF item ? 'originResourceVersionId' AND NOT EXISTS (
        SELECT 1 FROM rhiza_resource_versions rv JOIN rhiza_resources r ON r.resource_id=rv.resource_id
        WHERE rv.resource_version_id=item->>'originResourceVersionId' AND rv.digest=item->>'originDigest' AND r.workspace_id=NEW.project_id
      ) THEN RAISE EXCEPTION 'Manifest v1 origin ResourceVersion is invalid'; END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER rhiza_context_manifest_validate
BEFORE INSERT ON rhiza_context_manifests FOR EACH ROW EXECUTE FUNCTION rhiza_validate_frozen_context();
