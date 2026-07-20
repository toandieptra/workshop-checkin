CREATE TABLE IF NOT EXISTS zbs_templates (
    template_id TEXT PRIMARY KEY,
    template_name TEXT NOT NULL,
    status TEXT NOT NULL,
    quality TEXT,
    tag TEXT,
    template_type INTEGER,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    preview_url TEXT,
    price_sdt TEXT,
    price_uid TEXT,
    zalo_created_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_zbs_templates_status
    ON zbs_templates (status);

CREATE TABLE IF NOT EXISTS zbs_task_configs (
    task_key TEXT PRIMARY KEY,
    task_label TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT false,
    template_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

UPDATE role_permissions
SET permissions = (
        SELECT jsonb_agg(permission ORDER BY permission)
        FROM (
            SELECT DISTINCT jsonb_array_elements_text(
                permissions || '["zbs.read", "zbs.manage"]'::jsonb
            ) AS permission
        ) AS grants
    ),
    updated_at = now()
WHERE role IN ('admin', 'super_admin')
  AND NOT permissions @> '["zbs.read", "zbs.manage"]'::jsonb;
