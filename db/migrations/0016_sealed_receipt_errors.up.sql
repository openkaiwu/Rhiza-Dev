ALTER TABLE command_receipts ADD COLUMN error_content_ref jsonb;
ALTER TABLE command_receipts ADD CONSTRAINT command_receipt_sealed_error_valid CHECK (
  error_content_ref IS NULL OR (
    status = 'rejected' AND result IS NULL AND error = '{"sealed":true}'::jsonb
    AND jsonb_typeof(error_content_ref) = 'object'
    AND error_content_ref - ARRAY['format','contentId','reference'] = '{}'::jsonb
    AND error_content_ref->>'format' = 'rhiza.sealed-receipt.v1'
    AND jsonb_typeof(error_content_ref->'contentId') = 'string'
    AND length(error_content_ref->>'contentId') > 0
    AND jsonb_typeof(error_content_ref->'reference') = 'object'
    AND (error_content_ref->'reference') - ARRAY['version','digest','size','ciphertext'] = '{}'::jsonb
    AND error_content_ref->'reference'->'version' = '1'::jsonb
    AND (error_content_ref->'reference'->>'digest') ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(error_content_ref->'reference'->'size') = 'number'
    AND (error_content_ref->'reference'->>'size')::numeric BETWEEN 0 AND 67108864
    AND trunc((error_content_ref->'reference'->>'size')::numeric) = (error_content_ref->'reference'->>'size')::numeric
    AND jsonb_typeof(error_content_ref->'reference'->'ciphertext') = 'object'
    AND (error_content_ref->'reference'->'ciphertext') - ARRAY['digestAlgorithm','digest','blobRef','size'] = '{}'::jsonb
    AND error_content_ref->'reference'->'ciphertext'->>'digestAlgorithm' = 'sha256'
    AND (error_content_ref->'reference'->'ciphertext'->>'digest') ~ '^[a-f0-9]{64}$'
    AND error_content_ref->'reference'->'ciphertext'->>'blobRef' = 'sha256/' || left(error_content_ref->'reference'->'ciphertext'->>'digest', 2) || '/' || (error_content_ref->'reference'->'ciphertext'->>'digest')
    AND jsonb_typeof(error_content_ref->'reference'->'ciphertext'->'size') = 'number'
    AND (error_content_ref->'reference'->'ciphertext'->>'size')::numeric = (error_content_ref->'reference'->>'size')::numeric + 29
  ) IS TRUE
);
