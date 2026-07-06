-- =============================================
-- 010_registration_forms.sql
-- Form đăng ký workshop công khai:
--  - registration_forms: form admin tạo, gắn 1 workshop, có token + is_active
--  - registration_submissions: lịch sử submit của khách (nguồn chính vẫn là guests)
-- =============================================

CREATE TABLE IF NOT EXISTS registration_forms (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  token         text UNIQUE NOT NULL,           -- secrets.token_hex(16) — dùng trong URL /register/:token
  workshop_id   uuid NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  greeting      text,                           -- lời chào (không bắt buộc), hiển thị đầu form
  is_active     boolean NOT NULL DEFAULT true,
  created_by    text,                           -- 'admin' (mở rộng tương lai)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_registration_forms_token ON registration_forms(token);
CREATE INDEX IF NOT EXISTS idx_registration_forms_workshop ON registration_forms(workshop_id);

CREATE TABLE IF NOT EXISTS registration_submissions (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  form_id           uuid NOT NULL REFERENCES registration_forms(id) ON DELETE CASCADE,
  workshop_id       uuid NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  guest_id          uuid REFERENCES guests(id) ON DELETE SET NULL,  -- link ngược tới guest đã tạo
  full_name         text NOT NULL,
  phone             text NOT NULL,
  party_size        int NOT NULL DEFAULT 1,
  business_model    text,
  submitted_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_registration_submissions_form
  ON registration_submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_registration_submissions_workshop
  ON registration_submissions(workshop_id, submitted_at DESC);
