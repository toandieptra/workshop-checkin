-- =============================================
-- 007_refactor.sql
-- Refactor: bỏ face, thêm sync, dọn dẹp
-- =============================================

-- 1. Thêm cột sync vào bảng guests
ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS local_updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS lark_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'pending_push',
  ADD COLUMN IF NOT EXISTS sync_error TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 2. Đánh dấu guest đã có lark_record_id là 'synced'
UPDATE guests
  SET sync_status = 'synced',
      last_synced_at = NOW(),
      local_updated_at = COALESCE(updated_at, created_at)
  WHERE lark_record_id IS NOT NULL
    AND sync_status = 'pending_push';

-- 3. Giữ nguyên guests chưa sync (lark_record_id IS NULL) = 'pending_push'

-- 4. Index cho sync queries
CREATE INDEX IF NOT EXISTS idx_guests_sync_status
  ON guests(sync_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_guests_last_synced_at
  ON guests(last_synced_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_guests_deleted_at
  ON guests(deleted_at) WHERE deleted_at IS NOT NULL;

-- 5. Bảng sync_logs
CREATE TABLE IF NOT EXISTS sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  lark_record_id TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sync_logs_entity ON sync_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_sync_logs_created ON sync_logs(created_at DESC);

-- 6. Cập nhật CheckinLog: thêm cột mới
ALTER TABLE checkin_logs
  ADD COLUMN IF NOT EXISTS checked_in_by TEXT,
  ADD COLUMN IF NOT EXISTS note TEXT;

-- 7. Cập nhật method cũ thành 'admin'
UPDATE checkin_logs
  SET method = 'admin'
  WHERE method IN ('face', 'manual', 'qr', NULL);

-- 8. Xóa cột consent_face_recognition
ALTER TABLE guests DROP COLUMN IF EXISTS consent_face_recognition;

-- 9. Đổi CheckinLog.method default thành 'admin'
ALTER TABLE checkin_logs
  ALTER COLUMN method SET DEFAULT 'admin';
