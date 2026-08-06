UPDATE role_permissions
SET permissions = permissions || '{"reports.read", "reports.export"}'::text[]
WHERE role IN ('admin', 'super_admin');