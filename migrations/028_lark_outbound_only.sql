-- Lark Base is now a write-back destination only.
-- Legacy inbound states must be retried from the local source of truth.
UPDATE guests
SET sync_status = 'pending_push',
    sync_error = NULL
WHERE sync_status IN ('pending_pull', 'conflict');

ALTER TABLE guests DROP COLUMN IF EXISTS lark_updated_at;

COMMENT ON COLUMN workshops.last_synced_at IS
  'Thời điểm workshop được đẩy thành công lên Lark Base gần nhất.';
