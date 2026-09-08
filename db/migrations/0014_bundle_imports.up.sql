-- Import metadata is independent of the destination Workspace: staging must not create it.
CREATE TABLE bundle_imports (
  import_id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  workspace_id uuid NOT NULL,
  archive_digest text NOT NULL CHECK (archive_digest ~ '^[a-f0-9]{64}$'),
  state_digest text NOT NULL CHECK (state_digest ~ '^[a-f0-9]{64}$'),
  phase text NOT NULL DEFAULT 'validated' CHECK (phase IN ('validated', 'blobs-ready', 'activated')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bundle_imports_owner ON bundle_imports(owner_id, updated_at);

CREATE FUNCTION guard_bundle_import_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF ROW(NEW.import_id,NEW.owner_id,NEW.workspace_id,NEW.archive_digest,NEW.state_digest)
      IS DISTINCT FROM ROW(OLD.import_id,OLD.owner_id,OLD.workspace_id,OLD.archive_digest,OLD.state_digest)
    OR NEW.revision <> OLD.revision + 1
    OR NOT ((OLD.phase='validated' AND NEW.phase='blobs-ready') OR (OLD.phase='blobs-ready' AND NEW.phase='activated')) THEN
    RAISE EXCEPTION 'BUNDLE_IMPORT_INVALID_TRANSITION';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bundle_import_transition BEFORE UPDATE ON bundle_imports
FOR EACH ROW EXECUTE FUNCTION guard_bundle_import_transition();
