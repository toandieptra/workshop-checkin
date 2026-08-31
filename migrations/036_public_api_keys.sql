CREATE TABLE IF NOT EXISTS api_keys (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    name text NOT NULL,
    key_hash text NOT NULL UNIQUE,
    key_prefix text NOT NULL,
    scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
    rate_limit integer NOT NULL DEFAULT 120 CHECK (rate_limit > 0),
    is_active boolean NOT NULL DEFAULT true,
    expires_at timestamptz,
    created_by uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    last_used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_created_by ON api_keys(created_by);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active) WHERE is_active;
