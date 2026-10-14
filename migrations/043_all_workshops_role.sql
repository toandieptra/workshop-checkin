-- Vai trò áp dụng cho mọi workshop (kể cả workshop tạo sau) mà không cần đổi
-- vai trò toàn hệ thống. Quyền tại một workshop là hợp của vai trò này và vai trò
-- được gán riêng trong workshop_members. Tài khoản khách check-in không dùng được.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS all_workshops_role text;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_users_all_workshops_role_fkey') THEN
        ALTER TABLE admin_users ADD CONSTRAINT admin_users_all_workshops_role_fkey
            FOREIGN KEY (all_workshops_role) REFERENCES role_permissions(role) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_users_all_workshops_role_check') THEN
        ALTER TABLE admin_users ADD CONSTRAINT admin_users_all_workshops_role_check
            CHECK (all_workshops_role IS NULL OR (account_type <> 'checkin_guest' AND all_workshops_role <> 'super_admin'));
    END IF;
END $$;
