-- Keep persisted built-in role grants aligned with the application permission catalog.
UPDATE role_permissions
SET permissions = permissions || '["reports.read"]'::jsonb
WHERE role IN ('viewer', 'editor')
  AND NOT (permissions ? 'reports.read');

UPDATE role_permissions
SET permissions = permissions || '["reports.export"]'::jsonb
WHERE role = 'editor'
  AND NOT (permissions ? 'reports.export');
