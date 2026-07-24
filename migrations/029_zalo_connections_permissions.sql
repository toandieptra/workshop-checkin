UPDATE role_permissions
SET permissions = (
    SELECT jsonb_agg(DISTINCT permission ORDER BY permission)
    FROM jsonb_array_elements_text(
        COALESCE(permissions, '[]'::jsonb)
        || '["zalo_connections.read", "zalo_connections.manage"]'::jsonb
    ) AS item(permission)
), updated_at = NOW()
WHERE role IN ('admin', 'super_admin');
