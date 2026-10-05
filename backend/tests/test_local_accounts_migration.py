"""Exercise account migration constraints and replay using isolated PostgreSQL data."""
import os
from pathlib import Path
import subprocess
import uuid

import pytest


@pytest.mark.skipif(not os.environ.get("WORKSHOP_TEST_POSTGRES_CONTAINER"), reason="local PostgreSQL container not selected")
def test_local_accounts_migration_preserves_legacy_users_and_scoped_guests():
    schema = "test_local_accounts_" + uuid.uuid4().hex
    ids = [str(uuid.uuid4()) for _ in range(3)]
    workshop, legacy, guest = ids
    command = ["docker", "exec", "-i", os.environ["WORKSHOP_TEST_POSTGRES_CONTAINER"], "sh", "-c",
               'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"']
    migration = (Path(__file__).resolve().parents[2] / "migrations/040_local_checkin_accounts.sql").read_text()
    setup = f"""
CREATE SCHEMA {schema};
SET search_path TO {schema};
CREATE TABLE workshops(id uuid PRIMARY KEY);
CREATE TABLE admin_users(id uuid PRIMARY KEY, role text NOT NULL, permission_overrides jsonb NOT NULL DEFAULT '{{}}');
INSERT INTO workshops VALUES ('{workshop}');
INSERT INTO admin_users VALUES ('{legacy}', 'admin', '{{}}');
"""
    first = f"""
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id='{legacy}' AND account_type='lark' AND role='admin' AND password_hash IS NULL) THEN RAISE EXCEPTION 'legacy identity changed'; END IF;
 BEGIN
  INSERT INTO admin_users(id,role,account_type) VALUES (gen_random_uuid(),'user','local');
  RAISE EXCEPTION 'passwordless local account accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
INSERT INTO admin_users(id,role,account_type,password_hash,access_workshop_id,access_starts_at,access_expires_at)
VALUES ('{guest}','user','checkin_guest','hash','{workshop}',now(),now()+interval '1 hour');
"""
    last = f"""
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id='{guest}' AND account_type='checkin_guest' AND access_workshop_id='{workshop}' AND password_hash='hash') THEN RAISE EXCEPTION 'guest changed on replay'; END IF;
 BEGIN
  UPDATE admin_users SET role='admin' WHERE id='{guest}';
  RAISE EXCEPTION 'guest promoted globally';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
  UPDATE admin_users SET permission_overrides='{{"users.manage":true}}' WHERE id='{guest}';
  RAISE EXCEPTION 'guest granted global override';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
  UPDATE admin_users SET access_expires_at=access_starts_at WHERE id='{guest}';
  RAISE EXCEPTION 'invalid time window accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
DELETE FROM workshops WHERE id='{workshop}';
DO $$ BEGIN
 IF (SELECT access_workshop_id FROM admin_users WHERE id='{guest}') IS NOT NULL THEN RAISE EXCEPTION 'deleted workshop scope retained'; END IF;
 IF (SELECT account_type FROM admin_users WHERE id='{guest}') <> 'checkin_guest' THEN RAISE EXCEPTION 'guest became unrestricted'; END IF;
END $$;
"""
    try:
        result = subprocess.run(command, input=setup + migration + first + migration + last, text=True, capture_output=True, timeout=30)
        assert result.returncode == 0, result.stderr
    finally:
        subprocess.run(command, input=f"DROP SCHEMA IF EXISTS {schema} CASCADE;", text=True, capture_output=True, timeout=15, check=True)


@pytest.mark.skipif(not os.environ.get("WORKSHOP_TEST_POSTGRES_CONTAINER"), reason="local PostgreSQL container not selected")
def test_guest_username_migration_keeps_existing_access_and_replays_without_renaming():
    schema = "test_guest_usernames_" + uuid.uuid4().hex
    workshop, local, guest = [str(uuid.uuid4()) for _ in range(3)]
    command = ["docker", "exec", "-i", os.environ["WORKSHOP_TEST_POSTGRES_CONTAINER"], "sh", "-c", 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"']
    migrations = Path(__file__).resolve().parents[2] / "migrations"
    setup = f"""
CREATE SCHEMA {schema}; SET search_path TO {schema};
CREATE TABLE workshops(id uuid PRIMARY KEY);
CREATE TABLE admin_users(id uuid PRIMARY KEY, email text NOT NULL, role text NOT NULL, permission_overrides jsonb NOT NULL DEFAULT '{{}}');
CREATE UNIQUE INDEX uq_email ON admin_users(lower(email));
INSERT INTO workshops VALUES ('{workshop}');
INSERT INTO admin_users VALUES ('{local}','lark@example.com','admin','{{}}');
"""
    create_guest = f"""
INSERT INTO admin_users(id,email,role,account_type,password_hash,access_workshop_id,access_starts_at,access_expires_at)
VALUES ('{guest}','old-guest@example.com','user','checkin_guest','existing-hash','{workshop}',now(),now()+interval '1 hour');
"""
    migration = (migrations / "041_guest_usernames.sql").read_text()
    verify = f"""
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id='{guest}' AND username='guest_'||replace(id::text,'-','') AND access_workshop_id='{workshop}' AND password_hash='existing-hash' AND account_type='checkin_guest') THEN RAISE EXCEPTION 'guest identity or access lost'; END IF;
 IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id='{local}' AND username IS NULL AND email='lark@example.com') THEN RAISE EXCEPTION 'Lark identity changed'; END IF;
END $$;
UPDATE admin_users SET username='frontdesk' WHERE id='{guest}';
"""
    end = f"""
DO $$ BEGIN
 IF (SELECT username FROM admin_users WHERE id='{guest}') <> 'frontdesk' THEN RAISE EXCEPTION 'username reset on replay'; END IF;
 BEGIN
  UPDATE admin_users SET email=NULL WHERE id='{local}';
  RAISE EXCEPTION 'ordinary account lost required email';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
  UPDATE admin_users SET username='bad@username' WHERE id='{guest}';
  RAISE EXCEPTION 'email allowed as guest username';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO admin_users(id,email,username,role,account_type,password_hash,access_workshop_id,access_starts_at,access_expires_at)
  VALUES(gen_random_uuid(),NULL,'frontdesk','user','checkin_guest','hash','{workshop}',now(),now()+interval '1 hour');
  RAISE EXCEPTION 'duplicate username allowed';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
END $$;
INSERT INTO admin_users(id,email,username,role,account_type,password_hash,access_workshop_id,access_starts_at,access_expires_at)
VALUES (gen_random_uuid(),NULL,'desk-a','user','checkin_guest','hash','{workshop}',now(),now()+interval '1 hour'),
(gen_random_uuid(),NULL,'desk-b','user','checkin_guest','hash','{workshop}',now(),now()+interval '1 hour');
"""
    try:
        result = subprocess.run(command, input=setup + (migrations / "040_local_checkin_accounts.sql").read_text() + create_guest + migration + verify + migration + end, text=True, capture_output=True, timeout=30)
        assert result.returncode == 0, result.stderr
    finally:
        subprocess.run(command, input=f"DROP SCHEMA IF EXISTS {schema} CASCADE;", text=True, capture_output=True, timeout=15, check=True)
