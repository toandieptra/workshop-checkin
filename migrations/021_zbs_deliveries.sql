CREATE TABLE IF NOT EXISTS zbs_deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guest_id UUID REFERENCES guests(id) ON DELETE CASCADE NOT NULL,
    workshop_id UUID REFERENCES workshops(id) ON DELETE CASCADE NOT NULL,
    event_type TEXT NOT NULL,
    event_key TEXT NOT NULL UNIQUE,
    phone TEXT,
    template_id TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    msg_id TEXT,
    sent_time TIMESTAMPTZ,
    delivery_time TIMESTAMPTZ,
    last_error TEXT,
    provider_response JSONB,
    sending_started_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_zbs_deliveries_pending
    ON zbs_deliveries (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS ix_zbs_deliveries_guest
    ON zbs_deliveries (guest_id, event_type, created_at DESC);
