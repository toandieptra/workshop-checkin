-- Persist editable grants for the built-in application roles.
CREATE TABLE IF NOT EXISTS role_permissions (
  role text PRIMARY KEY,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO role_permissions (role, permissions) VALUES
  ('user', '[]'::jsonb),
  ('viewer', '["checkin.read", "guests.read", "lark.read", "registration_forms.read", "workshops.read"]'::jsonb),
  ('editor', '["checkin.manage", "checkin.read", "guests.read", "guests.write", "lark.read", "registration_forms.read", "registration_forms.write", "uploads.create", "workshops.read"]'::jsonb),
  ('admin', '["checkin.manage", "checkin.read", "guests.delete", "guests.export", "guests.read", "guests.write", "lark.read", "lark.sync", "registration_forms.read", "registration_forms.write", "uploads.create", "workshops.delete", "workshops.read", "workshops.write"]'::jsonb),
  ('super_admin', '["checkin.manage", "checkin.read", "guests.delete", "guests.export", "guests.read", "guests.write", "lark.read", "lark.sync", "registration_forms.read", "registration_forms.write", "uploads.create", "users.manage", "workshops.delete", "workshops.read", "workshops.write"]'::jsonb)
ON CONFLICT (role) DO NOTHING;
