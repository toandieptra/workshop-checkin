-- 001_init.sql : pgvector + pg_trgm + bang toi thieu Workshop Face Check-in
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS workshops (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  event_date  date,
  location    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guests (
  id                        uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id               uuid NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  full_name                 text NOT NULL,
  phone                     text,
  email                     text,
  company                   text,
  role_title                text,
  guest_type                text,
  note                      text,
  consent_face_recognition  boolean NOT NULL DEFAULT true,
  checkin_status            text NOT NULL DEFAULT 'not_checked_in',
  checked_in_at             timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_guests_workshop ON guests(workshop_id);
CREATE INDEX IF NOT EXISTS idx_guests_name_trgm ON guests USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_guests_phone_trgm ON guests USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_guests_company_trgm ON guests USING gin (company gin_trgm_ops);

CREATE TABLE IF NOT EXISTS face_profiles (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  guest_id      uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  image_url     text,
  embedding     vector(512),
  quality_score real,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_face_profiles_guest ON face_profiles(guest_id);
-- ivfflat cosine index (can ANALYZE sau khi co du lieu de hieu qua)
CREATE INDEX IF NOT EXISTS idx_face_profiles_embedding
  ON face_profiles USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE TABLE IF NOT EXISTS checkin_logs (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id    uuid NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  guest_id       uuid REFERENCES guests(id) ON DELETE SET NULL,
  method         text,            -- face | manual | qr
  similarity     real,
  snapshot_url   text,
  status         text,            -- checked_in | duplicate | rejected | candidate
  staff_feedback text,            -- correct | wrong | ignored | null
  checked_in_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_checkin_logs_workshop ON checkin_logs(workshop_id);

CREATE TABLE IF NOT EXISTS welcome_events (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id     uuid NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  guest_id        uuid REFERENCES guests(id) ON DELETE SET NULL,
  display_name    text,
  display_message text,
  event_type      text,           -- welcome | idle
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_welcome_events_workshop ON welcome_events(workshop_id);
