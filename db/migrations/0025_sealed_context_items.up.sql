CREATE FUNCTION rhiza_context_item_ref_valid(content_ref jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT (jsonb_typeof(content_ref) = 'object'
    AND content_ref - ARRAY['format','contentId','reference'] = '{}'::jsonb
    AND content_ref->>'format' = 'rhiza.sealed-context-item.v1'
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

CREATE FUNCTION rhiza_context_items_storage_valid(items jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item jsonb; field text;
BEGIN
  IF items IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(items) <> 'array' THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
    IF NOT (item ? 'contentRef') THEN CONTINUE; END IF;
    IF NOT (jsonb_typeof(item) = 'object'
      AND item - ARRAY['id','title','detail','role','status','tokens','selectionMode','sourceType','sourceId','sourceNodeId','pinned','contentVersion','score','contentRef'] = '{}'::jsonb
      AND jsonb_typeof(item->'id') = 'string' AND length(item->>'id') > 0
      AND item->>'title' = '' AND item->>'detail' = ''
      AND item->>'role' IN ('Fact','Constraint','Decision','Reference')
      AND item->>'status' IN ('active','recommended','excluded')
      AND jsonb_typeof(item->'tokens') = 'number'
      AND rhiza_context_item_ref_valid(item->'contentRef')) IS TRUE THEN RETURN false; END IF;
    FOREACH field IN ARRAY ARRAY['sourceId','sourceNodeId'] LOOP
      IF item ? field AND jsonb_typeof(item->field) <> 'string' THEN RETURN false; END IF;
    END LOOP;
    IF item ? 'selectionMode' AND NOT (item->>'selectionMode' IN ('CURRENT','USER_SELECTED','AI_RECOMMENDED_ACCEPTED','AUTO_RETRIEVED')) IS TRUE THEN RETURN false; END IF;
    IF item ? 'sourceType' AND NOT (item->>'sourceType' IN ('node','segment','file','chunk','reference')) IS TRUE THEN RETURN false; END IF;
    IF item ? 'pinned' AND jsonb_typeof(item->'pinned') <> 'boolean' THEN RETURN false; END IF;
    FOREACH field IN ARRAY ARRAY['contentVersion','score'] LOOP
      IF item ? field AND jsonb_typeof(item->field) <> 'number' THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  RETURN true;
END $$;
ALTER TABLE rhiza_projects ADD CONSTRAINT context_items_sealed_storage_valid
  CHECK (rhiza_context_items_storage_valid(state->'contextItems'));
