-- 049: Ghép UID Zalo (người dùng OA) với khách mời bằng tên Zalo.
-- Tên Zalo của khách lấy từ bridge Zalo cá nhân (tra theo SĐT, có giới hạn tần suất);
-- tên người dùng OA lấy từ API thông tin người dùng OA. Khớp chắc chắn → tự ghép; còn lại → gợi ý cho nhân viên.
-- Chạy lặp lại an toàn.

ALTER TABLE zalo_oa_users ADD COLUMN IF NOT EXISTS avatar text;
ALTER TABLE zalo_oa_users ADD COLUMN IF NOT EXISTS match_checked_at timestamptz;

-- Mỗi khách chỉ tra tên qua bridge một lần (kể cả không tìm thấy) để không tra lặp.
CREATE TABLE IF NOT EXISTS zalo_name_lookups (
    guest_id      uuid PRIMARY KEY REFERENCES guests(id) ON DELETE CASCADE,
    found         boolean NOT NULL,
    error         text,
    attempted_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_zalo_name_lookups_attempted ON zalo_name_lookups (attempted_at);

CREATE TABLE IF NOT EXISTS zalo_uid_suggestions (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    oa_user_id   text NOT NULL REFERENCES zalo_oa_users(user_id) ON DELETE CASCADE,
    guest_id     uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    phone        text NOT NULL,
    score        real NOT NULL DEFAULT 0,
    reasons      jsonb NOT NULL DEFAULT '[]'::jsonb,
    status       text NOT NULL DEFAULT 'pending',   -- pending | auto | confirmed | rejected
    decided_by   uuid REFERENCES admin_users(id) ON DELETE SET NULL,
    decided_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_zalo_uid_suggestion UNIQUE (oa_user_id, phone)
);
CREATE INDEX IF NOT EXISTS ix_zalo_uid_suggestions_status ON zalo_uid_suggestions (status);
