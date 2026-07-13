-- super_admin is the ownership/emergency-access role and can never be disabled.
UPDATE admin_users
SET is_active = TRUE,
    updated_at = NOW()
WHERE role = 'super_admin' AND is_active = FALSE;

ALTER TABLE admin_users
    DROP CONSTRAINT IF EXISTS ck_admin_users_super_admin_active;

ALTER TABLE admin_users
    ADD CONSTRAINT ck_admin_users_super_admin_active
    CHECK (role <> 'super_admin' OR is_active = TRUE);
