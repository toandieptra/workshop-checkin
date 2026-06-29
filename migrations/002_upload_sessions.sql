-- 002_upload_sessions.sql : bang phien upload anh tu mobile qua QR
CREATE TABLE IF NOT EXISTS upload_sessions (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  token       text NOT NULL,
  status      text NOT NULL DEFAULT 'open',   -- open | closed | expired
  images      jsonb NOT NULL DEFAULT '[]'::jsonb,
  max_files   int NOT NULL DEFAULT 30,
  subfolder   text,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_token ON upload_sessions(token);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_expires ON upload_sessions(expires_at);