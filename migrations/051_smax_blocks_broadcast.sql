-- 051: Quản lý block Smax (Zalo User) trong workshop + gửi Broadcast từ block cho khách được chọn.
-- smax_credentials: token Smax dán ở Cài đặt → Kết nối (ưu tiên hơn .env): Partner API token (SMAX_API_TOKEN)
-- và token đăng nhập web (SMAX_USER_TOKEN, có hạn) dùng cho API nội bộ tạo/sửa block. Chạy lặp lại an toàn.
CREATE TABLE IF NOT EXISTS smax_credentials (
    id          integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    user_token  text,
    updated_by  uuid REFERENCES admin_users(id) ON DELETE SET NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Partner API token (SMAX_API_TOKEN) dán ở Cài đặt → Kết nối, ưu tiên hơn .env.
ALTER TABLE smax_credentials ADD COLUMN IF NOT EXISTS api_token text;
ALTER TABLE smax_credentials ADD COLUMN IF NOT EXISTS api_token_updated_by uuid REFERENCES admin_users(id) ON DELETE SET NULL;
ALTER TABLE smax_credentials ADD COLUMN IF NOT EXISTS api_token_updated_at timestamptz;

ALTER TABLE zalo_deliveries ADD COLUMN IF NOT EXISTS rate_per_minute integer;
ALTER TABLE zalo_deliveries ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'template';
ALTER TABLE zalo_deliveries ADD COLUMN IF NOT EXISTS smax_block_id text;
