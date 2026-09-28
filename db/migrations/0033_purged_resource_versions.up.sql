ALTER TABLE rhiza_resource_versions ADD COLUMN purged_at timestamptz;

ALTER TABLE rhiza_resource_versions
  DROP CONSTRAINT rhiza_resource_versions_blob_ref_check,
  DROP CONSTRAINT rhiza_resource_versions_blob_identity_check;
ALTER TABLE rhiza_resource_versions
  ADD CONSTRAINT rhiza_resource_versions_blob_ref_check CHECK (
    blob_ref ~ '^sha256/[a-f0-9]{2}/[a-f0-9]{64}$'
    OR blob_ref ~ '^sealed-v1/[^/]+/[^/]+/[a-f0-9]{64}/[a-f0-9]{64}/(0|[1-9][0-9]*)$'
    OR blob_ref = 'purged-v1'
  ),
  ADD CONSTRAINT rhiza_resource_versions_blob_identity_check CHECK (
    (blob_ref LIKE 'sha256/%' AND purged_at IS NULL AND blob_ref = 'sha256/' || substring(digest from 1 for 2) || '/' || digest)
    OR (blob_ref LIKE 'sealed-v1/%' AND purged_at IS NULL AND split_part(blob_ref, '/', 5) = digest AND split_part(blob_ref, '/', 6)::numeric = size_bytes)
    OR (blob_ref = 'purged-v1' AND purged_at IS NOT NULL)
  );

ALTER TABLE purge_key_references DROP CONSTRAINT purge_key_references_content_family_check;
ALTER TABLE purge_key_references ADD CONSTRAINT purge_key_references_content_family_check
  CHECK (content_family IN ('node', 'message', 'manifest', 'segment', 'anchor', 'edge', 'context-item', 'journal', 'receipt-result', 'receipt-error', 'resource-version', 'resource', 'attachment', 'file-chunk'));
