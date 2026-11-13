-- 048: Người dùng OA (UID theo OA) nhận qua webhook sự kiện OA: follow/unfollow, user_send_*, user_submit_info,
-- và tin OA gửi tới người dùng. Ghép UID ↔ SĐT khi khách chia sẻ thông tin (user_submit_info) hoặc API
-- "thông tin người dùng" trả shared_info.phone. Chạy lặp lại an toàn.
CREATE TABLE IF NOT EXISTS zalo_oa_users (
    user_id            text PRIMARY KEY,
    user_id_by_app     text,
    display_name       text,
    is_follower        boolean,
    phone              text,
    phone_source       text,
    last_event         text,
    last_event_at      timestamptz,
    detail_checked_at  timestamptz,
    detail_error       text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_zalo_oa_users_phone ON zalo_oa_users (phone);

ALTER TABLE zbs_webhook_events ADD COLUMN IF NOT EXISTS server text;
ALTER TABLE zbs_webhook_events ADD COLUMN IF NOT EXISTS user_id text;
