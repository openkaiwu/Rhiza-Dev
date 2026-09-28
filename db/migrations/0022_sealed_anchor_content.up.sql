ALTER TABLE rhiza_anchors ADD COLUMN content_ref jsonb;
ALTER TABLE rhiza_anchors ADD CONSTRAINT anchor_sealed_content_valid CHECK (
  content_ref IS NULL OR (
    selected_text IS NULL AND (message_id IS NOT NULL OR segment_id IS NOT NULL)
    AND jsonb_typeof(content_ref) = 'object'
    AND content_ref - ARRAY['format','contentId','reference'] = '{}'::jsonb
    AND content_ref->>'format' = 'rhiza.sealed-anchor.v1'
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
