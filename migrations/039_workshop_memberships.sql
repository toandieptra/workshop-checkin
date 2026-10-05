-- Preserve legacy account access on existing workshops exactly once.
-- Deploy scripts may replay this file; revoked grants must never be recreated.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('039_workshop_memberships'));

CREATE TABLE IF NOT EXISTS workshop_members (
    user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    workshop_id uuid NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
    role text NOT NULL REFERENCES role_permissions(role) ON UPDATE CASCADE ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, workshop_id),
    CONSTRAINT workshop_members_no_super_admin CHECK (role <> 'super_admin')
);
CREATE INDEX IF NOT EXISTS ix_workshop_members_workshop_id ON workshop_members(workshop_id);

CREATE TABLE IF NOT EXISTS workshop_access_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

WITH first_run AS (
    INSERT INTO workshop_access_migrations (version)
    VALUES ('039_backfill_existing_access')
    ON CONFLICT DO NOTHING
    RETURNING version
), eligible_users AS (
    SELECT u.id, u.role
    FROM admin_users u
    JOIN role_permissions r ON r.role = u.role
    WHERE u.role NOT IN ('admin', 'super_admin')
      AND EXISTS (
        SELECT 1
        FROM (
            SELECT jsonb_array_elements_text(r.permissions) AS permission
            UNION
            SELECT key FROM jsonb_each(COALESCE(u.permission_overrides, '{}'::jsonb))
            WHERE value = 'true'::jsonb
        ) granted
        WHERE granted.permission IN (
            'workshops.read', 'workshops.write', 'workshops.delete',
            'guests.read', 'guests.write', 'guests.delete', 'guests.export',
            'checkin.read', 'checkin.manage',
            'registration_forms.read', 'registration_forms.write',
            'reports.read', 'reports.export', 'uploads.create',
            'zbs.read', 'zbs.manage',
            'zalo_messages.read', 'zalo_messages.send', 'zalo_messages.bulk_send'
        )
        AND (u.permission_overrides -> granted.permission) IS DISTINCT FROM 'false'::jsonb
      )
)
INSERT INTO workshop_members (user_id, workshop_id, role)
SELECT u.id, w.id, u.role
FROM eligible_users u CROSS JOIN workshops w CROSS JOIN first_run
ON CONFLICT (user_id, workshop_id) DO NOTHING;

COMMIT;
