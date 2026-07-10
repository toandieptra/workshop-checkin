-- =============================================
-- 012_workshop_management.sql
-- Mở rộng workshops + bảng workshop_media cho admin quản lý Workshop.
-- Giữ nguyên cột Lark (lark_workshop_name, last_synced_at) để backward-compatible.
-- =============================================

ALTER TABLE workshops
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS branch text,
  ADD COLUMN IF NOT EXISTS maps_url text,
  ADD COLUMN IF NOT EXISTS registration_short_url text;

-- Workshop đã tồn tại (từ Lark/sync) coi như đã published.
UPDATE workshops SET status = 'published' WHERE status = 'draft';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workshops_status_check'
  ) THEN
    ALTER TABLE workshops
      ADD CONSTRAINT workshops_status_check
      CHECK (status IN ('draft', 'published', 'completed', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_workshops_status ON workshops(status);
CREATE INDEX IF NOT EXISTS idx_workshops_branch ON workshops(branch);

CREATE TABLE IF NOT EXISTS workshop_media (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workshop_id  uuid NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  media_type   text NOT NULL DEFAULT 'banner',
  file_url     text NOT NULL,
  file_name    text,
  mime_type    text,
  file_size    integer,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workshop_media_type_check
    CHECK (media_type IN ('banner', 'invitation', 'document'))
);

CREATE INDEX IF NOT EXISTS idx_workshop_media_workshop
  ON workshop_media(workshop_id, sort_order);
