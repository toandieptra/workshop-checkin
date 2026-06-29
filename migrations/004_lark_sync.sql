-- 004_lark_sync.sql : đồng bộ khách Lark Base -> app
ALTER TABLE guests ADD COLUMN IF NOT EXISTS lark_record_id text;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS business_model text;
ALTER TABLE workshops ADD COLUMN IF NOT EXISTS lark_workshop_name text;

-- dedup: mỗi (workshop, lark_record_id) duy nhất
CREATE UNIQUE INDEX IF NOT EXISTS uq_guests_workshop_lark
  ON guests (workshop_id, lark_record_id)
  WHERE lark_record_id IS NOT NULL;

-- tra cứu nhanh khi write-back check-in
CREATE INDEX IF NOT EXISTS ix_guests_lark_record_id
  ON guests (lark_record_id)
  WHERE lark_record_id IS NOT NULL;

-- tra cứu workshop theo tên Lark khi sync
CREATE INDEX IF NOT EXISTS ix_workshops_lark_name
  ON workshops (lark_workshop_name)
  WHERE lark_workshop_name IS NOT NULL;