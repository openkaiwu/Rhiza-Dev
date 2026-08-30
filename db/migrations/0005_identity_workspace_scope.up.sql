CREATE TABLE IF NOT EXISTS users (
  user_id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  workspace_id uuid PRIMARY KEY REFERENCES rhiza_projects(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

-- Deterministic, repeatable local bootstrap.  Legacy project ids are retained.
INSERT INTO users (user_id, display_name)
VALUES ('00000000-0000-4000-8000-000000000002', 'Local user')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO workspaces (workspace_id, name, status, created_by)
SELECT id, title, 'active', '00000000-0000-4000-8000-000000000002'::uuid
FROM rhiza_projects
ON CONFLICT (workspace_id) DO NOTHING;

INSERT INTO workspace_members (workspace_id, user_id, role)
SELECT workspace_id, created_by, 'owner' FROM workspaces
ON CONFLICT (workspace_id, user_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON workspace_members(user_id, workspace_id);
CREATE INDEX IF NOT EXISTS workspaces_status_idx ON workspaces(status, updated_at DESC);
