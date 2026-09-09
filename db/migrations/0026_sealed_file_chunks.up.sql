CREATE FUNCTION rhiza_file_chunk_ref_valid(content_ref jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT (jsonb_typeof(content_ref) = 'object'
    AND content_ref - ARRAY['format','contentId','reference'] = '{}'::jsonb
    AND content_ref->>'format' = 'rhiza.sealed-file-chunk.v1'
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
    AND (content_ref->'reference'->'ciphertext'->>'size')::numeric = (content_ref->'reference'->>'size')::numeric + 29) IS TRUE
$$;

CREATE FUNCTION rhiza_file_chunks_storage_valid(items jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item jsonb; field text;
BEGIN
  IF items IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(items) <> 'array' THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
    IF NOT (item ? 'contentRef') THEN CONTINUE; END IF;
    IF NOT (jsonb_typeof(item) = 'object'
      AND item - ARRAY['id','attachmentId','ordinal','startOffset','endOffset','tokens','resourceVersionId','text','terms','embedding','contentRef'] = '{}'::jsonb
      AND jsonb_typeof(item->'id') = 'string' AND length(item->>'id') > 0
      AND jsonb_typeof(item->'attachmentId') = 'string' AND length(item->>'attachmentId') > 0
      AND item->>'text' = '' AND item->'terms' = '[]'::jsonb AND item->'embedding' = '[]'::jsonb
      AND rhiza_file_chunk_ref_valid(item->'contentRef')) IS TRUE THEN RETURN false; END IF;
    FOREACH field IN ARRAY ARRAY['ordinal','startOffset','endOffset','tokens'] LOOP
      IF NOT (jsonb_typeof(item->field) = 'number'
        AND (item->>field)::numeric >= 0
        AND trunc((item->>field)::numeric) = (item->>field)::numeric) IS TRUE THEN RETURN false; END IF;
    END LOOP;
    IF (item->>'endOffset')::numeric < (item->>'startOffset')::numeric THEN RETURN false; END IF;
    IF item ? 'resourceVersionId' AND jsonb_typeof(item->'resourceVersionId') <> 'string' THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;
ALTER TABLE rhiza_projects ADD CONSTRAINT file_chunks_sealed_storage_valid
  CHECK (rhiza_file_chunks_storage_valid(state->'fileChunks'));
