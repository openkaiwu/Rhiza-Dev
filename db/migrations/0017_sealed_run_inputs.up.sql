ALTER TABLE execution_runs ADD COLUMN input_content_ref jsonb;
ALTER TABLE execution_runs ADD CONSTRAINT execution_run_sealed_input_valid CHECK (
  input_content_ref IS NULL OR (
    input_envelope = '{"sealed":true}'::jsonb AND record->'input' = '{"sealed":true}'::jsonb
    AND jsonb_typeof(input_content_ref) = 'object'
    AND input_content_ref - ARRAY['format','contentId','reference'] = '{}'::jsonb
    AND input_content_ref->>'format' = 'rhiza.sealed-run-input.v1'
    AND length(input_content_ref->>'contentId') > 0
    AND jsonb_typeof(input_content_ref->'contentId') = 'string'
    AND jsonb_typeof(input_content_ref->'reference') = 'object'
    AND (input_content_ref->'reference') - ARRAY['version','digest','size','ciphertext'] = '{}'::jsonb
    AND input_content_ref->'reference'->>'version' = '1'
    AND jsonb_typeof(input_content_ref->'reference'->'version') = 'number'
    AND (input_content_ref->'reference'->>'digest') ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(input_content_ref->'reference'->'size') = 'number'
    AND (input_content_ref->'reference'->>'size')::numeric BETWEEN 0 AND 67108864
    AND trunc((input_content_ref->'reference'->>'size')::numeric) = (input_content_ref->'reference'->>'size')::numeric
    AND jsonb_typeof(input_content_ref->'reference'->'ciphertext') = 'object'
    AND (input_content_ref->'reference'->'ciphertext') - ARRAY['digestAlgorithm','digest','blobRef','size'] = '{}'::jsonb
    AND input_content_ref->'reference'->'ciphertext'->>'digestAlgorithm' = 'sha256'
    AND (input_content_ref->'reference'->'ciphertext'->>'digest') ~ '^[a-f0-9]{64}$'
    AND input_content_ref->'reference'->'ciphertext'->>'blobRef' = 'sha256/' || left(input_content_ref->'reference'->'ciphertext'->>'digest', 2) || '/' || (input_content_ref->'reference'->'ciphertext'->>'digest')
    AND jsonb_typeof(input_content_ref->'reference'->'ciphertext'->'size') = 'number'
    AND (input_content_ref->'reference'->'ciphertext'->>'size')::numeric = (input_content_ref->'reference'->>'size')::numeric + 29
  ) IS TRUE
);

CREATE FUNCTION protect_execution_run_content_ref() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.input_content_ref IS DISTINCT FROM NEW.input_content_ref THEN
    RAISE EXCEPTION 'ExecutionRun content reference is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER execution_run_content_ref_immutable BEFORE UPDATE ON execution_runs
  FOR EACH ROW EXECUTE FUNCTION protect_execution_run_content_ref();
