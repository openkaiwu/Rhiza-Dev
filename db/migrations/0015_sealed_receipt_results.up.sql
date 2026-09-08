-- Ciphertext references coexist with legacy results during the bounded migration.
-- A receipt never keeps both the encrypted reference and the original plaintext.
ALTER TABLE command_receipts ADD COLUMN result_content_ref jsonb;
ALTER TABLE command_receipts ADD CONSTRAINT command_receipt_sealed_result_valid CHECK (
  result_content_ref IS NULL OR (
    result IS NULL AND status = 'committed'
    AND jsonb_typeof(result_content_ref) = 'object'
    AND result_content_ref - ARRAY['format','contentId','reference'] = '{}'::jsonb
    AND result_content_ref->>'format' = 'rhiza.sealed-receipt.v1'
    AND length(result_content_ref->>'contentId') > 0
    AND jsonb_typeof(result_content_ref->'contentId') = 'string'
    AND jsonb_typeof(result_content_ref->'reference') = 'object'
    AND (result_content_ref->'reference') - ARRAY['version','digest','size','ciphertext'] = '{}'::jsonb
    AND result_content_ref->'reference'->>'version' = '1'
    AND jsonb_typeof(result_content_ref->'reference'->'version') = 'number'
    AND (result_content_ref->'reference'->>'digest') ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(result_content_ref->'reference'->'size') = 'number'
    AND (result_content_ref->'reference'->>'size')::numeric BETWEEN 0 AND 67108864
    AND trunc((result_content_ref->'reference'->>'size')::numeric) = (result_content_ref->'reference'->>'size')::numeric
    AND jsonb_typeof(result_content_ref->'reference'->'ciphertext') = 'object'
    AND (result_content_ref->'reference'->'ciphertext') - ARRAY['digestAlgorithm','digest','blobRef','size'] = '{}'::jsonb
    AND result_content_ref->'reference'->'ciphertext'->>'digestAlgorithm' = 'sha256'
    AND (result_content_ref->'reference'->'ciphertext'->>'digest') ~ '^[a-f0-9]{64}$'
    AND result_content_ref->'reference'->'ciphertext'->>'blobRef' = 'sha256/' || left(result_content_ref->'reference'->'ciphertext'->>'digest', 2) || '/' || (result_content_ref->'reference'->'ciphertext'->>'digest')
    AND jsonb_typeof(result_content_ref->'reference'->'ciphertext'->'size') = 'number'
    AND (result_content_ref->'reference'->'ciphertext'->>'size')::numeric = (result_content_ref->'reference'->>'size')::numeric + 29
  ) IS TRUE
);
