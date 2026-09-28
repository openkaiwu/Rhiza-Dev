DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM rhiza_resource_versions WHERE blob_ref LIKE 'sealed-v1/%') THEN
    RAISE EXCEPTION 'Cannot remove scoped resource blob references while encrypted versions exist';
  END IF;
END $$;

ALTER TABLE rhiza_resource_versions
  DROP CONSTRAINT rhiza_resource_versions_blob_ref_check,
  DROP CONSTRAINT rhiza_resource_versions_blob_identity_check;

ALTER TABLE rhiza_resource_versions
  ADD CONSTRAINT rhiza_resource_versions_blob_ref_check CHECK (blob_ref ~ '^sha256/[a-f0-9]{2}/[a-f0-9]{64}$'),
  ADD CONSTRAINT rhiza_resource_versions_check CHECK (blob_ref = 'sha256/' || substring(digest from 1 for 2) || '/' || digest);
