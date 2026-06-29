-- 003_admin_fields.sql : them so khach tham gia (party_size) cho guest
ALTER TABLE guests ADD COLUMN IF NOT EXISTS party_size integer NOT NULL DEFAULT 1;
