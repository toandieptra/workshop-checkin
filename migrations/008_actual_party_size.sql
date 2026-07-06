-- =============================================
-- 008_actual_party_size.sql
-- Thêm cột actual_party_size cho self check-in
-- =============================================

ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS actual_party_size INT;

-- Comment giúp hiểu ý nghĩa cột
COMMENT ON COLUMN guests.actual_party_size IS
  'Số người tham gia thực tế (do khách tự điền khi check-in qua QR). '
  'NULL = chưa check-in hoặc dùng party_size đăng ký.';