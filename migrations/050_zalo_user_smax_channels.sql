-- 050: Kênh Zalo cá nhân qua Smax (thay zalo-agent bridge). Admin bật kênh được dùng và chọn kênh mặc định;
-- mỗi lượt gửi ghi lại kênh đã dùng. Chạy lặp lại an toàn.
CREATE TABLE IF NOT EXISTS zalo_user_channels (
    page_pid          text PRIMARY KEY,          -- Smax page pid (zlw…)
    name              text NOT NULL,
    enabled           boolean NOT NULL DEFAULT false,
    is_default        boolean NOT NULL DEFAULT false,
    connection_error  text,
    synced_at         timestamptz,
    updated_at        timestamptz NOT NULL DEFAULT now()
);
-- Tối đa một kênh mặc định
CREATE UNIQUE INDEX IF NOT EXISTS uq_zalo_user_channels_default ON zalo_user_channels (is_default) WHERE is_default;

ALTER TABLE zalo_deliveries ADD COLUMN IF NOT EXISTS sender_page_pid text;
