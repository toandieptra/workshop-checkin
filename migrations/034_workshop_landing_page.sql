ALTER TABLE workshops
    ADD COLUMN IF NOT EXISTS landing_registration_form_id uuid
    REFERENCES registration_forms(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_workshops_landing_registration_form
    ON workshops(landing_registration_form_id);
