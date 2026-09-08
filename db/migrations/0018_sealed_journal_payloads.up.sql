ALTER TABLE workspace_events ADD COLUMN payload_content_ref jsonb;
ALTER TABLE workspace_events ADD CONSTRAINT journal_sealed_payload_valid CHECK (
  payload_content_ref IS NULL OR (
    payload = '{"sealed":true}'::jsonb
    AND jsonb_typeof(payload_content_ref) = 'object'
    AND payload_content_ref - ARRAY['format','contentId','reference'] = '{}'::jsonb
    AND payload_content_ref->>'format' = 'rhiza.sealed-journal.v1'
    AND length(payload_content_ref->>'contentId') > 0
    AND jsonb_typeof(payload_content_ref->'contentId') = 'string'
    AND jsonb_typeof(payload_content_ref->'reference') = 'object'
    AND (payload_content_ref->'reference') - ARRAY['version','digest','size','ciphertext'] = '{}'::jsonb
    AND payload_content_ref->'reference'->>'version' = '1'
    AND jsonb_typeof(payload_content_ref->'reference'->'version') = 'number'
    AND (payload_content_ref->'reference'->>'digest') ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(payload_content_ref->'reference'->'size') = 'number'
    AND (payload_content_ref->'reference'->>'size')::numeric BETWEEN 0 AND 67108864
    AND trunc((payload_content_ref->'reference'->>'size')::numeric) = (payload_content_ref->'reference'->>'size')::numeric
    AND jsonb_typeof(payload_content_ref->'reference'->'ciphertext') = 'object'
    AND (payload_content_ref->'reference'->'ciphertext') - ARRAY['digestAlgorithm','digest','blobRef','size'] = '{}'::jsonb
    AND payload_content_ref->'reference'->'ciphertext'->>'digestAlgorithm' = 'sha256'
    AND (payload_content_ref->'reference'->'ciphertext'->>'digest') ~ '^[a-f0-9]{64}$'
    AND payload_content_ref->'reference'->'ciphertext'->>'blobRef' = 'sha256/' || left(payload_content_ref->'reference'->'ciphertext'->>'digest', 2) || '/' || (payload_content_ref->'reference'->'ciphertext'->>'digest')
    AND jsonb_typeof(payload_content_ref->'reference'->'ciphertext'->'size') = 'number'
    AND (payload_content_ref->'reference'->'ciphertext'->>'size')::numeric = (payload_content_ref->'reference'->>'size')::numeric + 29
  ) IS TRUE
);
