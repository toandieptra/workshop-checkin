ALTER TABLE workshops
    ADD COLUMN IF NOT EXISTS auto_confirm_registration boolean NOT NULL DEFAULT true;

ALTER TABLE guests
    ADD COLUMN IF NOT EXISTS registration_status text NOT NULL DEFAULT 'confirmed',
    ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
    ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES admin_users(id) ON DELETE SET NULL;

UPDATE guests
SET registration_status = 'confirmed',
    confirmed_at = COALESCE(confirmed_at, registered_at, created_at)
WHERE registration_status IS NULL
   OR registration_status NOT IN ('pending', 'confirmed')
   OR (registration_status = 'confirmed' AND confirmed_at IS NULL);

ALTER TABLE guests DROP CONSTRAINT IF EXISTS guests_registration_status_check;
ALTER TABLE guests
    ADD CONSTRAINT guests_registration_status_check
    CHECK (registration_status IN ('pending', 'confirmed'));
