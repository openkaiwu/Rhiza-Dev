CREATE TABLE rhiza_resources (
  resource_id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES rhiza_projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('attachment')),
  logical_name text NOT NULL CHECK (char_length(logical_name) BETWEEN 1 AND 240),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rhiza_resource_versions (
  resource_version_id text PRIMARY KEY,
  resource_id text NOT NULL REFERENCES rhiza_resources(resource_id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  digest_algorithm text NOT NULL CHECK (digest_algorithm = 'sha256'),
  digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  canonicalization text NOT NULL CHECK (canonicalization = 'raw-v1'),
  media_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  blob_ref text NOT NULL CHECK (blob_ref ~ '^sha256/[a-f0-9]{2}/[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_id, version),
  CHECK (blob_ref = 'sha256/' || substring(digest from 1 for 2) || '/' || digest)
);

CREATE TABLE rhiza_resource_materializations (
  materialization_id text PRIMARY KEY,
  resource_version_id text NOT NULL REFERENCES rhiza_resource_versions(resource_version_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('file-chunks')),
  generator text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE rhiza_attachments
  ADD COLUMN resource_id text REFERENCES rhiza_resources(resource_id) ON DELETE RESTRICT,
  ADD COLUMN resource_version_id text REFERENCES rhiza_resource_versions(resource_version_id) ON DELETE RESTRICT;

CREATE INDEX rhiza_resources_workspace_idx ON rhiza_resources(workspace_id, created_at);
CREATE INDEX rhiza_resource_versions_resource_idx ON rhiza_resource_versions(resource_id, version);
CREATE INDEX rhiza_resource_versions_blob_idx ON rhiza_resource_versions(blob_ref);
CREATE INDEX rhiza_resource_materializations_version_idx ON rhiza_resource_materializations(resource_version_id);

CREATE OR REPLACE FUNCTION rhiza_reject_resource_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'rhiza_resource_versions are immutable';
END;
$$;

CREATE TRIGGER rhiza_resource_versions_immutable
BEFORE UPDATE OR DELETE ON rhiza_resource_versions
FOR EACH ROW EXECUTE FUNCTION rhiza_reject_resource_version_mutation();
