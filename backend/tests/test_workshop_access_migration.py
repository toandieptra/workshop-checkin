"""Run against an isolated schema in a local PostgreSQL container when enabled."""
import os
from pathlib import Path
import subprocess
import uuid

import pytest


@pytest.mark.skipif(not os.environ.get("WORKSHOP_TEST_POSTGRES_CONTAINER"), reason="local PostgreSQL container not selected")
def test_backfill_preserves_effective_grants_once_and_foreign_keys_cleanup():
    container = os.environ["WORKSHOP_TEST_POSTGRES_CONTAINER"]
    schema = "test_workshop_access_" + uuid.uuid4().hex
    command = ["docker", "exec", "-i", container, "sh", "-c",
               'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"']
    migration = (Path(__file__).resolve().parents[2] / "migrations/039_workshop_memberships.sql").read_text()
    a, b, viewer, denied, override, newcomer, admin = [str(uuid.uuid4()) for _ in range(7)]
    setup = f"""
CREATE SCHEMA {schema};
SET search_path TO {schema};
CREATE TABLE role_permissions (role text PRIMARY KEY, permissions jsonb NOT NULL);
CREATE TABLE admin_users (id uuid PRIMARY KEY, role text, permission_overrides jsonb NOT NULL DEFAULT '{{}}');
CREATE TABLE workshops (id uuid PRIMARY KEY);
INSERT INTO role_permissions VALUES ('viewer', '["guests.read"]'), ('user', '[]'), ('admin', '["guests.read"]'), ('super_admin', '[]');
INSERT INTO admin_users VALUES
 ('{viewer}', 'viewer', '{{}}'),
 ('{denied}', 'viewer', '{{"guests.read":false,"unknown.permission":true}}'),
 ('{override}', 'user', '{{"guests.write":true}}'),
 ('{admin}', 'admin', '{{}}');
INSERT INTO workshops VALUES ('{a}');
"""
    check_first = f"""
DO $$ BEGIN
 IF (SELECT count(*) FROM workshop_members) <> 2 THEN RAISE EXCEPTION 'effective grant backfill mismatch'; END IF;
 IF NOT EXISTS (SELECT 1 FROM workshop_members WHERE user_id='{viewer}' AND role='viewer') THEN RAISE EXCEPTION 'legacy role missing'; END IF;
 IF NOT EXISTS (SELECT 1 FROM workshop_members WHERE user_id='{override}' AND role='user') THEN RAISE EXCEPTION 'override access missing'; END IF;
END $$;
DELETE FROM workshop_members WHERE user_id='{viewer}';
INSERT INTO workshops VALUES ('{b}');
INSERT INTO admin_users VALUES ('{newcomer}', 'viewer', '{{}}');
"""
    check_second = f"""
DO $$ BEGIN
 IF (SELECT count(*) FROM workshop_members) <> 1 THEN RAISE EXCEPTION 'migration replay granted access'; END IF;
 IF EXISTS (SELECT 1 FROM workshop_members WHERE user_id IN ('{viewer}', '{newcomer}') OR workshop_id='{b}') THEN RAISE EXCEPTION 'new or revoked membership restored'; END IF;
 IF (SELECT count(*) FROM workshop_access_migrations) <> 1 THEN RAISE EXCEPTION 'migration marker mismatch'; END IF;
 BEGIN
   INSERT INTO workshop_members(user_id,workshop_id,role) VALUES ('{admin}','{a}','super_admin');
   RAISE EXCEPTION 'super admin workshop membership accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
DELETE FROM workshops WHERE id='{a}';
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM workshop_members) THEN RAISE EXCEPTION 'workshop cascade failed'; END IF;
END $$;
INSERT INTO workshop_members(user_id,workshop_id,role) VALUES ('{viewer}','{b}','viewer');
DELETE FROM admin_users WHERE id='{viewer}';
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM workshop_members) THEN RAISE EXCEPTION 'user cascade failed'; END IF;
END $$;
"""
    try:
        completed = subprocess.run(command, input=setup + migration + check_first + migration + check_second,
                                   text=True, capture_output=True, timeout=30)
        assert completed.returncode == 0, completed.stderr
    finally:
        subprocess.run(command, input=f"DROP SCHEMA IF EXISTS {schema} CASCADE;", text=True,
                       capture_output=True, timeout=15, check=True)
