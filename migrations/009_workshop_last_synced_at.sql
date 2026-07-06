-- =============================================
-- 009_workshop_last_synced_at.sql
-- Thêm cột last_synced_at cho workshop để theo dõi
-- lần đồng bộ gần nhất từ Lark config table.
-- =============================================

ALTER TABLE workshops
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN workshops.last_synced_at IS
  'Thời điểm đồng bộ gần nhất từ bảng Lark workshop config. '
  'NULL = chưa từng đồng bộ qua POST /api/lark/sync/workshops.';