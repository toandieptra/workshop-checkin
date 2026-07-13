-- Custom roles (role_permissions) must be assignable on admin_users.
-- 014 locked role to a fixed enum; drop that CHECK and enforce via FK instead.

-- Ensure any existing admin_users.role values exist in the catalog first.
INSERT INTO role_permissions (role, label, permissions)
SELECT DISTINCT u.role, u.role, '[]'::jsonb
FROM admin_users u
LEFT JOIN role_permissions r ON r.role = u.role
WHERE r.role IS NULL
ON CONFLICT (role) DO NOTHING;

UPDATE role_permissions
SET label = role
WHERE label IS NULL;

ALTER TABLE admin_users
  DROP CONSTRAINT IF EXISTS admin_users_role_check;

ALTER TABLE admin_users
  DROP CONSTRAINT IF EXISTS admin_users_role_fkey;

ALTER TABLE admin_users
  ADD CONSTRAINT admin_users_role_fkey
  FOREIGN KEY (role) REFERENCES role_permissions(role);
