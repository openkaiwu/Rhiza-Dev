CREATE FUNCTION rhiza_sealed_manifest_projection_valid(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item jsonb;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'object'
    OR value - ARRAY['schemaVersion','versions','contextItems'] <> '{}'::jsonb
    OR jsonb_typeof(value->'contextItems') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF value ? 'schemaVersion' AND value->>'schemaVersion' IS DISTINCT FROM '1.0.0' THEN RETURN false; END IF;
  IF value ? 'versions' AND (jsonb_typeof(value->'versions') IS DISTINCT FROM 'object'
    OR (value->'versions') - ARRAY['planner','compiler','contributors','tokenizer','selectionPolicy'] <> '{}'::jsonb) THEN RETURN false; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(value->'contextItems') LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
      OR item - ARRAY['resourceId','resourceVersionId','digest','contributorVersion','selectionMode','priority','reason','originResourceVersionId','originDigest'] <> '{}'::jsonb
      OR (item->>'reason' IN ('[sealed]','')) IS NOT TRUE THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

ALTER TABLE rhiza_context_manifests ADD COLUMN content_ref jsonb;
ALTER TABLE rhiza_context_manifests ADD CONSTRAINT manifest_sealed_content_valid CHECK (
  content_ref IS NULL OR (
    rhiza_sealed_manifest_projection_valid(manifest)
    AND jsonb_typeof(content_ref) = 'object'
    AND content_ref - ARRAY['format','contentId','reference'] = '{}'::jsonb
    AND content_ref->>'format' = 'rhiza.sealed-manifest.v1'
    AND length(content_ref->>'contentId') > 0
    AND jsonb_typeof(content_ref->'contentId') = 'string'
    AND jsonb_typeof(content_ref->'reference') = 'object'
    AND (content_ref->'reference') - ARRAY['version','digest','size','ciphertext'] = '{}'::jsonb
    AND content_ref->'reference'->>'version' = '1'
    AND jsonb_typeof(content_ref->'reference'->'version') = 'number'
    AND (content_ref->'reference'->>'digest') ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(content_ref->'reference'->'size') = 'number'
    AND (content_ref->'reference'->>'size')::numeric BETWEEN 0 AND 67108864
    AND trunc((content_ref->'reference'->>'size')::numeric) = (content_ref->'reference'->>'size')::numeric
    AND jsonb_typeof(content_ref->'reference'->'ciphertext') = 'object'
    AND (content_ref->'reference'->'ciphertext') - ARRAY['digestAlgorithm','digest','blobRef','size'] = '{}'::jsonb
    AND content_ref->'reference'->'ciphertext'->>'digestAlgorithm' = 'sha256'
    AND (content_ref->'reference'->'ciphertext'->>'digest') ~ '^[a-f0-9]{64}$'
    AND content_ref->'reference'->'ciphertext'->>'blobRef' = 'sha256/' || left(content_ref->'reference'->'ciphertext'->>'digest', 2) || '/' || (content_ref->'reference'->'ciphertext'->>'digest')
    AND jsonb_typeof(content_ref->'reference'->'ciphertext'->'size') = 'number'
    AND (content_ref->'reference'->'ciphertext'->>'size')::numeric = (content_ref->'reference'->>'size')::numeric + 29
  ) IS TRUE
);
