-- 046: Lưu UID Zalo của khách — Zalo trả về qua webhook "user_received_message" (recipient.id)
-- sau khi khách nhận tin ZNS (vd. tin xác nhận đăng ký). UID dùng để gửi thông báo / remarketing.
-- Lưu theo SĐT (đã chuẩn hoá 0xxxxxxxxx): một người đăng ký nhiều workshop dùng chung một UID.
-- Chạy lặp lại an toàn.

ALTER TABLE zbs_deliveries ADD COLUMN IF NOT EXISTS recipient_uid text;

CREATE TABLE IF NOT EXISTS zalo_contact_uids (
    phone          text PRIMARY KEY,
    zalo_uid       text NOT NULL,
    source         text NOT NULL DEFAULT 'zns_webhook',
    last_msg_id    text,
    first_seen_at  timestamptz NOT NULL DEFAULT now(),
    last_seen_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_zalo_contact_uids_uid ON zalo_contact_uids (zalo_uid);

-- Nhật ký sự kiện webhook ZBS (để chẩn đoán cấu hình; giữ gọn — chỉ ghi các trường cần thiết).
CREATE TABLE IF NOT EXISTS zbs_webhook_events (
    id           bigserial PRIMARY KEY,
    event_name   text,
    msg_id       text,
    tracking_id  text,
    matched      boolean NOT NULL DEFAULT false,
    signature_ok boolean,
    received_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_zbs_webhook_events_received ON zbs_webhook_events (received_at DESC);
