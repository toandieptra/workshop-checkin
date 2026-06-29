-- 005_registered_at.sql : ngày đăng ký khách (map từ Lark field "Ngày tạo")
CREATE EXTENSION IF NOT EXISTS unaccent;

ALTER TABLE guests ADD COLUMN IF NOT EXISTS registered_at timestamptz;

UPDATE guests
SET registered_at = created_at
WHERE registered_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_guests_registered_at
  ON guests (workshop_id, registered_at DESC);
