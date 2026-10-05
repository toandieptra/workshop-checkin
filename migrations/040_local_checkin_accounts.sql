-- Existing directory accounts remain Lark accounts; local credentials are opt-in.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('040_local_checkin_accounts'));

ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'lark';
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS access_workshop_id uuid;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS access_starts_at timestamptz;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS access_expires_at timestamptz;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'admin_users'::regclass AND conname = 'admin_users_access_workshop_fkey') THEN
        ALTER TABLE admin_users ADD CONSTRAINT admin_users_access_workshop_fkey FOREIGN KEY (access_workshop_id) REFERENCES workshops(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'admin_users'::regclass AND conname = 'admin_users_account_type_check') THEN
        ALTER TABLE admin_users ADD CONSTRAINT admin_users_account_type_check CHECK (account_type IN ('lark', 'local', 'checkin_guest'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'admin_users'::regclass AND conname = 'admin_users_password_required') THEN
        ALTER TABLE admin_users ADD CONSTRAINT admin_users_password_required CHECK (account_type = 'lark' OR password_hash IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'admin_users'::regclass AND conname = 'admin_users_guest_access_check') THEN
        -- Workshop may become NULL through ON DELETE SET NULL; authentication
        -- then fails closed. The time and functional limits remain mandatory.
        ALTER TABLE admin_users ADD CONSTRAINT admin_users_guest_access_check CHECK (account_type <> 'checkin_guest' OR (role = 'user' AND permission_overrides = '{}'::jsonb AND access_starts_at IS NOT NULL AND access_expires_at IS NOT NULL AND access_starts_at < access_expires_at));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'admin_users'::regclass AND conname = 'admin_users_non_guest_access_check') THEN
        ALTER TABLE admin_users ADD CONSTRAINT admin_users_non_guest_access_check CHECK (account_type = 'checkin_guest' OR (access_workshop_id IS NULL AND access_starts_at IS NULL AND access_expires_at IS NULL));
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_admin_users_access_workshop_id ON admin_users(access_workshop_id);
-- Migration 014 already provides the case-insensitive unique email index.
COMMIT;
