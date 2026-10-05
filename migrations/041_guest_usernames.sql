BEGIN;
SELECT pg_advisory_xact_lock(410041);
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE admin_users ALTER COLUMN email DROP NOT NULL;

-- Preserve identities and access windows. Existing guests receive a unique
-- username once; administrators may subsequently replace it in Users settings.
UPDATE admin_users SET username = 'guest_' || replace(id::text, '-', '')
WHERE account_type = 'checkin_guest' AND username IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_users_username_ci ON admin_users(lower(username));
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='admin_users'::regclass AND conname='admin_users_login_identity_check') THEN
        ALTER TABLE admin_users ADD CONSTRAINT admin_users_login_identity_check CHECK (
            (account_type='checkin_guest' AND username IS NOT NULL)
            OR (account_type<>'checkin_guest' AND username IS NULL AND email IS NOT NULL)
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='admin_users'::regclass AND conname='admin_users_username_check') THEN
        ALTER TABLE admin_users ADD CONSTRAINT admin_users_username_check CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9._-]{2,63}$');
    END IF;
END $$;
COMMIT;
