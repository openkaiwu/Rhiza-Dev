ALTER TABLE rhiza_resource_versions
  DROP CONSTRAINT rhiza_resource_versions_blob_ref_check,
  DROP CONSTRAINT rhiza_resource_versions_check;

ALTER TABLE rhiza_resource_versions
  ADD CONSTRAINT rhiza_resource_versions_blob_ref_check CHECK (
    blob_ref ~ '^sha256/[a-f0-9]{2}/[a-f0-9]{64}$'
    OR blob_ref ~ '^sealed-v1/[^/]+/[^/]+/[a-f0-9]{64}/[a-f0-9]{64}/(0|[1-9][0-9]*)$'
  ),
  ADD CONSTRAINT rhiza_resource_versions_blob_identity_check CHECK (
    (blob_ref LIKE 'sha256/%' AND blob_ref = 'sha256/' || substring(digest from 1 for 2) || '/' || digest)
    OR (blob_ref LIKE 'sealed-v1/%' AND split_part(blob_ref, '/', 5) = digest AND split_part(blob_ref, '/', 6)::numeric = size_bytes)
  );
