ALTER TABLE rhiza_attachments DROP COLUMN IF EXISTS resource_version_id;
ALTER TABLE rhiza_attachments DROP COLUMN IF EXISTS resource_id;
DROP TRIGGER IF EXISTS rhiza_resource_versions_immutable ON rhiza_resource_versions;
DROP FUNCTION IF EXISTS rhiza_reject_resource_version_mutation();
DROP TABLE IF EXISTS rhiza_resource_materializations;
DROP TABLE IF EXISTS rhiza_resource_versions;
DROP TABLE IF EXISTS rhiza_resources;
