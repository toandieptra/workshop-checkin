-- Auto-send flags for personal Zalo templates.
ALTER TABLE zalo_templates
  ADD COLUMN IF NOT EXISTS auto_send_new_guest BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_send_checkin BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN zalo_templates.auto_send_new_guest IS
  'Tự động xếp hàng gửi mẫu tin khi có guest mới.';
COMMENT ON COLUMN zalo_templates.auto_send_checkin IS
  'Tự động xếp hàng gửi mẫu tin khi khách check-in lần đầu.';
