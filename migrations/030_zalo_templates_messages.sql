-- Zalo personal-account templates, recipient mappings, delivery queue, and daily quota.
CREATE TABLE IF NOT EXISTS zalo_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    content_blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
    created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_zalo_templates_status_updated
    ON zalo_templates (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS guest_zalo_mappings (
    guest_id UUID PRIMARY KEY REFERENCES guests(id) ON DELETE CASCADE,
    account_owner_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    recipient_name TEXT,
    source TEXT NOT NULL DEFAULT 'bridge',
    resolution JSONB NOT NULL DEFAULT '{}'::jsonb,
    resolved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_guest_zalo_mappings_recipient
    ON guest_zalo_mappings (account_owner_id, recipient_id);

CREATE TABLE IF NOT EXISTS zalo_delivery_batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT,
    template_id UUID REFERENCES zalo_templates(id) ON DELETE SET NULL,
    selection JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'queued',
    created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zalo_deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id UUID REFERENCES zalo_delivery_batches(id) ON DELETE SET NULL,
    template_id UUID REFERENCES zalo_templates(id) ON DELETE SET NULL,
    template_name TEXT NOT NULL,
    content_blocks JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    recipient_count INTEGER NOT NULL DEFAULT 0,
    sent_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_zalo_deliveries_created
    ON zalo_deliveries (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_zalo_deliveries_batch ON zalo_deliveries (batch_id);

CREATE TABLE IF NOT EXISTS zalo_quota_usage (
    account_owner_id TEXT NOT NULL,
    capability TEXT NOT NULL CHECK (capability IN ('friend_lookup', 'message')),
    usage_date DATE NOT NULL,
    daily_limit INTEGER NOT NULL,
    used_count INTEGER NOT NULL DEFAULT 0,
    reserved_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (account_owner_id, capability, usage_date),
    CHECK (daily_limit >= 0 AND used_count >= 0 AND reserved_count >= 0)
);

CREATE TABLE IF NOT EXISTS zalo_quota_reservations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_owner_id TEXT NOT NULL,
    capability TEXT NOT NULL CHECK (capability IN ('friend_lookup', 'message')),
    usage_date DATE NOT NULL,
    delivery_id UUID UNIQUE REFERENCES zalo_deliveries(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL CHECK (amount > 0),
    consumed_count INTEGER NOT NULL DEFAULT 0,
    released_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'released')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (account_owner_id, capability, usage_date)
        REFERENCES zalo_quota_usage(account_owner_id, capability, usage_date) ON DELETE RESTRICT,
    CHECK (consumed_count >= 0 AND released_count >= 0 AND consumed_count + released_count <= amount)
);
CREATE INDEX IF NOT EXISTS ix_zalo_quota_reservations_active
    ON zalo_quota_reservations (status, expires_at);

CREATE TABLE IF NOT EXISTS zalo_delivery_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    delivery_id UUID NOT NULL REFERENCES zalo_deliveries(id) ON DELETE CASCADE,
    guest_id UUID REFERENCES guests(id) ON DELETE SET NULL,
    recipient_id TEXT,
    recipient_name TEXT,
    phone TEXT,
    block_position INTEGER NOT NULL,
    block_payload JSONB NOT NULL,
    quota_cost INTEGER NOT NULL DEFAULT 1 CHECK (quota_cost > 0),
    status TEXT NOT NULL DEFAULT 'pending',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sending_started_at TIMESTAMPTZ,
    message_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    provider_response JSONB,
    last_error TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_zalo_delivery_items_pending
    ON zalo_delivery_items (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS ix_zalo_delivery_items_delivery
    ON zalo_delivery_items (delivery_id, guest_id, block_position);

UPDATE role_permissions
SET permissions = (
    SELECT jsonb_agg(DISTINCT permission ORDER BY permission)
    FROM jsonb_array_elements_text(
        COALESCE(permissions, '[]'::jsonb)
        || '["zalo_templates.read", "zalo_templates.manage", "zalo_messages.read", "zalo_messages.send"]'::jsonb
    ) AS item(permission)
), updated_at = NOW()
WHERE role IN ('admin', 'super_admin');
