-- Lark organization directory metadata and singleton sync status.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS enterprise_email text;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS lark_user_id text;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS lark_account_status text;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS lark_is_activated boolean;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS lark_is_frozen boolean;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS lark_is_resigned boolean;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS lark_last_synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_users_lark_user_id
  ON admin_users (lark_user_id) WHERE lark_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admin_users_lark_account_status
  ON admin_users (lark_account_status);

CREATE TABLE IF NOT EXISTS admin_directory_sync_state (
  id integer PRIMARY KEY CHECK (id = 1),
  status text NOT NULL DEFAULT 'never',
  started_at timestamptz,
  finished_at timestamptz,
  users_seen integer NOT NULL DEFAULT 0,
  users_created integer NOT NULL DEFAULT 0,
  users_updated integer NOT NULL DEFAULT 0,
  users_deactivated integer NOT NULL DEFAULT 0,
  users_skipped integer NOT NULL DEFAULT 0,
  error text
);

INSERT INTO admin_directory_sync_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
