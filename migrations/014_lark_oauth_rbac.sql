-- Lark OAuth identities, opaque database sessions, and RBAC.
CREATE TABLE IF NOT EXISTS admin_users (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email text NOT NULL,
  name text,
  avatar_url text,
  lark_open_id text,
  lark_union_id text,
  lark_tenant_key text,
  role text NOT NULL DEFAULT 'viewer',
  permission_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_users_role_check CHECK (role IN ('super_admin', 'admin', 'editor', 'viewer', 'user'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_users_email_lower ON admin_users (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_users_lark_open_id
  ON admin_users (lark_open_id) WHERE lark_open_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_users_lark_union_id
  ON admin_users (lark_union_id) WHERE lark_union_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS admin_sessions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  ip_address text
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_user_id ON admin_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS admin_oauth_states (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  state_hash text NOT NULL UNIQUE,
  return_to text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_oauth_states_expires_at ON admin_oauth_states(expires_at);
