CREATE TABLE IF NOT EXISTS guest_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  content TEXT NOT NULL CHECK (length(btrim(content)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guest_notes_guest_created
  ON guest_notes(guest_id, created_at DESC);
