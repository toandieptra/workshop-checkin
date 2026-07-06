-- =============================================
-- 011_registration_form_workshops.sql
-- Cho phép 1 form đăng ký gắn nhiều workshop.
-- Giữ cột registration_forms.workshop_id để backward-compatible với form cũ,
-- nhưng nguồn đúng từ migration này trở đi là bảng registration_form_workshops.
-- =============================================

CREATE TABLE IF NOT EXISTS registration_form_workshops (
  form_id     uuid NOT NULL REFERENCES registration_forms(id) ON DELETE CASCADE,
  workshop_id uuid NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (form_id, workshop_id)
);
CREATE INDEX IF NOT EXISTS idx_registration_form_workshops_workshop
  ON registration_form_workshops(workshop_id);

-- Backfill form cũ: mỗi form cũ đang có 1 workshop_id.
INSERT INTO registration_form_workshops (form_id, workshop_id)
SELECT id, workshop_id
FROM registration_forms
WHERE workshop_id IS NOT NULL
ON CONFLICT DO NOTHING;
