-- =============================================
-- 013_workshop_event_time.sql
-- Thêm giờ sự kiện (hh:mm) cho workshops.
-- =============================================

ALTER TABLE workshops
  ADD COLUMN IF NOT EXISTS event_time time;
