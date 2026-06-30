-- 006_face_profile_source.sql : phan biet anh tham chieu (admin upload) vs anh check-in (snapshot)
--   'reference' = ảnh tham chiếu do admin/QR upload, toi da MAX_FACE_IMAGES_PER_GUEST (3)
--   'checkin'   = ảnh chup tu dong tu camera khi check-in thanh cong, rolling MAX_CHECKIN_SNAPSHOTS_PER_GUEST (2)

ALTER TABLE face_profiles
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'reference';

ALTER TABLE face_profiles
  DROP CONSTRAINT IF EXISTS face_profiles_source_check;
ALTER TABLE face_profiles
  ADD CONSTRAINT face_profiles_source_check
  CHECK (source IN ('reference', 'checkin'));

-- rolling window theo guest + source + created_at
CREATE INDEX IF NOT EXISTS idx_face_profiles_guest_source_created
  ON face_profiles (guest_id, source, created_at DESC);