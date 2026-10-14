-- Tài khoản khách check-in được cấp nhiều workshop hoặc tất cả workshop.
-- access_workshop_id cũ được chép sang bảng mới rồi để NULL khi quản trị viên lưu lại phạm vi,
-- nên chạy lại file này không khôi phục workshop đã bị gỡ.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS access_all_workshops boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS guest_workshop_access (
    user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    workshop_id uuid NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, workshop_id)
);
CREATE INDEX IF NOT EXISTS ix_guest_workshop_access_workshop_id ON guest_workshop_access(workshop_id);

INSERT INTO guest_workshop_access (user_id, workshop_id)
SELECT id, access_workshop_id FROM admin_users
WHERE account_type = 'checkin_guest' AND access_workshop_id IS NOT NULL
ON CONFLICT DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_users_all_workshops_guest_only') THEN
        ALTER TABLE admin_users ADD CONSTRAINT admin_users_all_workshops_guest_only
            CHECK (account_type = 'checkin_guest' OR access_all_workshops = false);
    END IF;
END $$;
