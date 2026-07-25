-- Granular permissions for personal Zalo templates and bulk messaging.
UPDATE role_permissions
SET permissions = (
    SELECT jsonb_agg(DISTINCT permission ORDER BY permission)
    FROM jsonb_array_elements_text(
        COALESCE(permissions, '[]'::jsonb)
        || '["zalo_templates.create", "zalo_templates.edit", "zalo_templates.delete", "zalo_messages.bulk_send"]'::jsonb
    ) AS item(permission)
), updated_at = NOW()
WHERE role IN ('admin', 'super_admin');
