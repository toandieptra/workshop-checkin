UPDATE role_permissions
SET permissions = permissions || '["reports.read", "reports.export"]'::jsonb
WHERE role IN ('admin', 'super_admin');