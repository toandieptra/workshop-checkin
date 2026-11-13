-- 047: Lưu thêm user_id_by_app (ID người dùng theo app, dùng cho Social API) từ webhook Zalo. Chạy lặp lại an toàn.
ALTER TABLE zalo_contact_uids ADD COLUMN IF NOT EXISTS zalo_uid_by_app text;
ALTER TABLE zbs_deliveries ADD COLUMN IF NOT EXISTS recipient_uid_by_app text;
