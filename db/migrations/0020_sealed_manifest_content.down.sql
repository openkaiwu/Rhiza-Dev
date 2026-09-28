DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM rhiza_context_manifests WHERE content_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot remove sealed Manifest references before restoring content';
  END IF;
END $$;
ALTER TABLE rhiza_context_manifests DROP CONSTRAINT manifest_sealed_content_valid;
ALTER TABLE rhiza_context_manifests DROP COLUMN content_ref;
DROP FUNCTION rhiza_sealed_manifest_projection_valid(jsonb);
