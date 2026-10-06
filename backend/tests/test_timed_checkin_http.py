"""HTTP tests for password accounts and time-limited event check-in staff.

Requests use real session cookies and the production authentication dependency.
Only storage and external check-in side effects are replaced with isolated
fixtures, so account changes must be observed through the next HTTP request.
"""
import re
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.auth import dependencies, local_accounts
from app.auth.permissions import PERMISSIONS, ROLE_PERMISSIONS
from app.auth.session import token_hash
from app.config import settings
from app.db import Base, get_db
from app.models import (
    AdminSession, AdminUser, CheckinLog, Guest, RegistrationForm,
    RolePermission, WelcomeEvent, Workshop, WorkshopMember,
)
from app.routers import (
    admin_users, admin_workshops, auth, checkin, guests, import_export,
    registration_forms, search, workshops,
)


@compiles(JSONB, "sqlite")
def _compile_jsonb(_element, _compiler, **_kwargs):
    return "JSON"


class AwaitableSession:
    def __init__(self, session):
        self.session = session

    async def execute(self, statement, *args, **kwargs):
        return self.session.execute(statement, *args, **kwargs)

    async def scalar(self, statement, *args, **kwargs):
        return self.session.scalar(statement, *args, **kwargs)

    async def get(self, model, key):
        return self.session.get(model, key)

    def add(self, value):
        self.session.add(value)

    async def flush(self):
        self.session.flush()

    async def commit(self):
        self.session.commit()

    async def refresh(self, value):
        self.session.refresh(value)

    async def rollback(self):
        self.session.rollback()

    async def delete(self, value):
        self.session.delete(value)


PASSWORD = "Checkin-staff-12345"


@pytest.fixture(scope="module")
def password_hash():
    return local_accounts.hash_password(PASSWORD)


@pytest.fixture
def ctx(monkeypatch, password_hash):
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def install_uuid(connection, _record):
        connection.create_function("uuid_generate_v4", 0, lambda: uuid.uuid4().hex)
        # PostgreSQL regexp_replace(text, pattern, replacement, 'g') used by duplicate-phone checks.
        connection.create_function("regexp_replace", 4, lambda value, pattern, repl, _flags: re.sub(pattern, repl, value or ""))

    Base.metadata.create_all(engine)
    session = Session(engine, expire_on_commit=False)
    db = AwaitableSession(session)
    now = datetime.now(timezone.utc)
    ws = [Workshop(id=uuid.uuid4(), name=f"Event {name}", slug=f"event-{name.lower()}", status="published") for name in "AB"]
    owner = AdminUser(id=uuid.uuid4(), email="owner@example.com", name="Owner", role="super_admin", account_type="lark", is_active=True, permission_overrides={})
    staff = AdminUser(
        id=uuid.uuid4(), email=None, username="checkin-staff", name="Check-in staff", role="user",
        account_type="checkin_guest", password_hash=password_hash, is_active=True,
        permission_overrides={}, access_workshop_id=ws[0].id,
        access_starts_at=now - timedelta(hours=1), access_expires_at=now + timedelta(hours=1),
    )
    local = AdminUser(
        id=uuid.uuid4(), email="local@example.com", name="Local editor", role="user",
        account_type="local", password_hash=password_hash, is_active=True, permission_overrides={},
    )
    records = [Guest(id=uuid.uuid4(), workshop_id=w.id, full_name=f"Attendee {name}", registration_status="confirmed") for w, name in zip(ws, "AB")]
    owner_token = "isolated-owner-session"
    owner_session = AdminSession(id=uuid.uuid4(), user_id=owner.id, token_hash=token_hash(owner_token), expires_at=now + timedelta(days=1))
    session.add_all([
        *[RolePermission(role=role, label=role, permissions=sorted(grants)) for role, grants in ROLE_PERMISSIONS.items()],
        *ws, owner, staff, local, *records, owner_session,
        WorkshopMember(user_id=local.id, workshop_id=ws[0].id, role="editor"),
        WorkshopMember(user_id=local.id, workshop_id=ws[1].id, role="viewer"),
    ])
    session.commit()
    app = FastAPI()
    for module in (auth, admin_users, admin_workshops, workshops, guests, checkin, search, import_export, registration_forms):
        app.include_router(module.router)

    async def database():
        try:
            yield db
        finally:
            session.rollback()

    app.dependency_overrides[get_db] = database
    monkeypatch.setattr(settings, "AUTH_COOKIE_SECURE", False)
    monkeypatch.setattr(auth, "check_login_rate_limit", AsyncMock())
    effects = SimpleNamespace(mark=AsyncMock(), clear=AsyncMock(), zbs=AsyncMock(), zalo=AsyncMock(), broadcast=AsyncMock())
    monkeypatch.setattr(guests, "mark_checked_in", effects.mark)
    monkeypatch.setattr(guests, "clear_dedup", effects.clear)
    monkeypatch.setattr(guests.manager, "broadcast", effects.broadcast)
    from app.services import zalo_messages, zbs
    monkeypatch.setattr(zbs, "enqueue_checkin", effects.zbs)
    monkeypatch.setattr(zalo_messages, "enqueue_auto_send_checkin", effects.zalo)

    with TestClient(app) as client, TestClient(app) as admin:
        admin.cookies.set(settings.AUTH_SESSION_COOKIE, owner_token)
        yield SimpleNamespace(
            app=app, client=client, admin=admin, session=session, db=db,
            staff=staff, local=local, owner=owner, workshops=ws, guests=records,
            now=now, effects=effects,
        )
    session.close()
    engine.dispose()


def _login(ctx, user=None, password=PASSWORD):
    return ctx.client.post("/api/auth/login", json={"identifier": getattr(user or ctx.staff, "username", None) or (user or ctx.staff).email, "password": password})


def _assert_logged_in(ctx, user=None):
    response = _login(ctx, user)
    assert response.status_code == 200, response.text
    assert ctx.client.get("/api/auth/me").status_code == 200
    return response.json()


def _guest_create_body(ctx, **changes):
    return {
        "name": "Temporary reception", "username": "reception",
        "password": PASSWORD, "account_type": "checkin_guest",
        "access_workshop_id": str(ctx.workshops[0].id),
        "access_starts_at": (ctx.now - timedelta(minutes=10)).isoformat(),
        "access_expires_at": (ctx.now + timedelta(minutes=30)).isoformat(),
        **changes,
    }


def test_guest_login_payload_and_cookie_have_only_fixed_scoped_permissions(ctx):
    result = _assert_logged_in(ctx)
    assert result["account_type"] == "checkin_guest"
    assert result["access_workshop_id"] == str(ctx.workshops[0].id)
    assert result["permissions"] == []
    assert len(result["workshop_access"]) == 1
    scope = result["workshop_access"][0]
    assert scope["workshop_id"] == str(ctx.workshops[0].id)
    assert set(scope["permissions"]) == {"guests.read", "guests.create", "checkin.read", "checkin.manage"}
    assert "password" not in result and "password_hash" not in result
    session = ctx.session.scalar(select(AdminSession).where(AdminSession.user_id == ctx.staff.id))
    assert local_accounts.utc_datetime(session.expires_at) <= local_accounts.utc_datetime(ctx.staff.access_expires_at)
    assert {row["id"] for row in ctx.client.get("/api/workshops", params={"permission": "guests.read"}).json()} == {str(ctx.workshops[0].id)}
    assert {row["id"] for row in ctx.client.get("/api/search/guests", params={"q": "Attendee"}).json()} == {str(ctx.guests[0].id)}
    assert ctx.client.get(f"/api/admin/workshops/{ctx.workshops[0].id}/welcome/latest").status_code == 200
    assert ctx.client.get(f"/api/admin/workshops/{ctx.workshops[1].id}/welcome/latest").status_code == 403


def test_guest_can_check_in_only_assigned_workshop_without_cross_scope_side_effects(ctx):
    _assert_logged_in(ctx)
    denied = ctx.client.post(f"/api/guests/{ctx.guests[1].id}/checkin", json={"actual_party_size": 2})
    assert denied.status_code == 403
    assert ctx.guests[1].checkin_status == "not_checked_in"
    assert ctx.session.scalar(select(CheckinLog)) is None
    assert ctx.session.scalar(select(WelcomeEvent)) is None
    for effect in vars(ctx.effects).values():
        effect.assert_not_awaited()

    allowed = ctx.client.post(f"/api/guests/{ctx.guests[0].id}/checkin", json={"actual_party_size": 2})
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["guest"]["checkin_status"] == "checked_in"
    assert allowed.json()["guest"]["actual_party_size"] == 2
    assert ctx.session.scalar(select(CheckinLog.workshop_id)) == ctx.workshops[0].id
    assert ctx.client.get("/api/checkin/logs", params={"workshop_id": str(ctx.workshops[0].id)}).status_code == 200
    assert ctx.client.get("/api/checkin/logs", params={"workshop_id": str(ctx.workshops[1].id)}).status_code == 403
    ctx.effects.mark.assert_awaited_once()
    ctx.effects.zbs.assert_awaited_once()
    ctx.effects.zalo.assert_awaited_once()


def test_guest_cannot_write_guests_export_forms_or_manage_users(ctx):
    _assert_logged_in(ctx)
    workshop_id, guest_id = ctx.workshops[0].id, ctx.guests[0].id
    cases = [
        ("patch", f"/api/guests/{guest_id}", {"full_name": "Forbidden"}),
        ("post", f"/api/guests/{guest_id}/notes", {"content": "Forbidden"}),
        ("get", f"/api/export/guests?workshop_id={workshop_id}", None),
        ("get", f"/api/export/guests?workshop_id={workshop_id}&export_context=reports", None),
        ("post", "/api/registration-forms", {"workshop_ids": [str(workshop_id)]}),
        ("patch", f"/api/workshops/{workshop_id}", {"name": "Forbidden"}),
        ("post", f"/api/guests/{guest_id}/confirm", None),
        ("get", "/api/admin/users", None),
        ("post", "/api/admin/users", _guest_create_body(ctx)),
        ("patch", f"/api/admin/users/{ctx.staff.id}", {"role": "super_admin"}),
        ("put", f"/api/admin/workshops/{workshop_id}/members", {"members": []}),
    ]
    for method, url, body in cases:
        response = ctx.client.request(method, url, json=body)
        assert response.status_code == 403, (url, response.text)
    assert ctx.guests[0].full_name == "Attendee A"
    assert ctx.session.scalar(select(RegistrationForm)) is None


@pytest.mark.parametrize("state", ["wrong_password", "unknown", "lark", "inactive", "future", "expired"])
def test_unavailable_accounts_and_wrong_credentials_cannot_create_session(ctx, state):
    password, user = PASSWORD, ctx.staff
    if state == "wrong_password":
        password = "Wrong-password-12345"
    elif state == "unknown":
        user = SimpleNamespace(email="not-present@example.com")
    elif state == "lark":
        # Having a password value must not make a Lark-only account password-enabled.
        ctx.owner.password_hash = ctx.staff.password_hash
        user = ctx.owner
    elif state == "inactive":
        ctx.staff.is_active = False
    elif state == "future":
        ctx.staff.access_starts_at = ctx.now + timedelta(minutes=5)
    elif state == "expired":
        ctx.staff.access_expires_at = ctx.now - timedelta(minutes=5)
    ctx.session.commit()
    response = _login(ctx, user, password)
    assert response.status_code == 401, response.text
    assert ctx.client.get("/api/auth/me").status_code == 401
    if hasattr(user, "id") and user.id != ctx.owner.id:
        assert ctx.session.scalar(select(AdminSession).where(AdminSession.user_id == user.id)) is None


@pytest.mark.parametrize("boundary", ["before", "start", "end"])
def test_access_window_is_start_inclusive_and_end_exclusive(ctx, monkeypatch, boundary):
    at = {"before": ctx.now - timedelta(microseconds=1), "start": ctx.now, "end": ctx.now + timedelta(hours=1)}[boundary]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return at if tz else at.replace(tzinfo=None)

    ctx.staff.access_starts_at = ctx.now
    ctx.staff.access_expires_at = ctx.now + timedelta(hours=1)
    ctx.session.commit()
    monkeypatch.setattr(local_accounts, "datetime", Clock)
    monkeypatch.setattr(dependencies, "datetime", Clock)
    monkeypatch.setattr(auth, "datetime", Clock)
    response = _login(ctx)
    assert response.status_code == (200 if boundary == "start" else 401), response.text
    assert ctx.client.get("/api/auth/me").status_code == (200 if boundary == "start" else 401)


@pytest.mark.parametrize("change", ["expire", "future", "lock", "scope_removed", "session_revoked"])
def test_existing_cookie_stops_working_on_next_request_when_access_is_revoked(ctx, change):
    _assert_logged_in(ctx)
    if change == "expire":
        ctx.staff.access_expires_at = ctx.now - timedelta(seconds=1)
    elif change == "future":
        ctx.staff.access_starts_at = ctx.now + timedelta(minutes=10)
    elif change == "lock":
        ctx.staff.is_active = False
    elif change == "scope_removed":
        ctx.staff.access_workshop_id = None
    else:
        row = ctx.session.scalar(select(AdminSession).where(AdminSession.user_id == ctx.staff.id))
        response = ctx.admin.delete(f"/api/admin/users/{ctx.staff.id}/sessions/{row.id}")
        assert response.status_code == 204, response.text
    ctx.session.commit()
    response = ctx.client.post(f"/api/guests/{ctx.guests[0].id}/checkin", json={})
    assert response.status_code == 401, response.text
    assert ctx.guests[0].checkin_status == "not_checked_in"
    assert ctx.session.scalar(select(CheckinLog)) is None


def test_existing_cookie_reads_changed_workshop_scope_from_database(ctx):
    _assert_logged_in(ctx)
    ctx.staff.access_workshop_id = ctx.workshops[1].id
    ctx.session.commit()
    assert ctx.client.get(f"/api/guests/{ctx.guests[0].id}").status_code == 403
    assert ctx.client.get(f"/api/guests/{ctx.guests[1].id}").status_code == 200
    result = ctx.client.get("/api/auth/me").json()
    assert [row["workshop_id"] for row in result["workshop_access"]] == [str(ctx.workshops[1].id)]


def test_guest_memberships_and_corrupt_role_overrides_never_expand_grants(ctx):
    _assert_logged_in(ctx)
    # Defense in depth: even legacy/corrupted rows must not promote a timed
    # check-in account. Normal writes are separately constrained and rejected.
    ctx.session.execute(text("PRAGMA ignore_check_constraints = ON"))
    ctx.staff.role = "super_admin"
    ctx.staff.permission_overrides = {permission: True for permission in PERMISSIONS}
    ctx.session.add(WorkshopMember(user_id=ctx.staff.id, workshop_id=ctx.workshops[1].id, role="admin"))
    ctx.session.commit()
    result = ctx.client.get("/api/auth/me")
    assert result.status_code == 200, result.text
    assert result.json()["permissions"] == []
    assert len(result.json()["workshop_access"]) == 1
    assert set(result.json()["workshop_access"][0]["permissions"]) == {"guests.read", "guests.create", "checkin.read", "checkin.manage"}
    assert ctx.client.get(f"/api/guests/{ctx.guests[1].id}").status_code == 403
    assert ctx.client.get("/api/admin/users").status_code == 403
    assert ctx.client.post("/api/workshops", json={"name": "Forbidden workshop"}).status_code == 403
    assert ctx.client.get("/api/export/guests", params={"workshop_id": str(ctx.workshops[0].id)}).status_code == 403


def test_local_account_creation_login_and_workshop_roles(ctx):
    result = ctx.admin.post("/api/admin/users", json={"name": "New local", "email": "  NEW.LOCAL@example.com  ", "password": PASSWORD, "account_type": "local", "role": "user"})
    assert result.status_code == 201, result.text
    payload = result.json()
    assert payload["email"] == "new.local@example.com"
    assert payload["account_type"] == "local"
    assert "password" not in payload and "password_hash" not in payload
    created = ctx.session.get(AdminUser, uuid.UUID(payload["id"]))
    assert created.password_hash != PASSWORD
    assert local_accounts.verify_password(PASSWORD, created.password_hash)
    _assert_logged_in(ctx, created)
    assert ctx.client.get(f"/api/guests/{ctx.guests[0].id}").status_code == 403

    _assert_logged_in(ctx, ctx.local)
    assert ctx.client.patch(f"/api/guests/{ctx.guests[0].id}", json={"full_name": "Allowed local edit"}).status_code == 200
    assert ctx.client.get(f"/api/guests/{ctx.guests[1].id}").status_code == 200
    assert ctx.client.patch(f"/api/guests/{ctx.guests[1].id}", json={"full_name": "Forbidden"}).status_code == 403
    assert ctx.client.get("/api/admin/users").status_code == 403


def test_create_guest_sets_fixed_role_and_can_log_in(ctx):
    response = ctx.admin.post("/api/admin/users", json=_guest_create_body(ctx))
    assert response.status_code == 201, response.text
    result = response.json()
    assert result["role"] == "user" and result["permission_overrides"] == {}
    assert result["permissions"] == []
    guest = ctx.session.get(AdminUser, uuid.UUID(result["id"]))
    _assert_logged_in(ctx, guest)
    assert ctx.client.get(f"/api/guests/{ctx.guests[0].id}").status_code == 200
    assert ctx.client.get(f"/api/guests/{ctx.guests[1].id}").status_code == 403


def test_password_reset_revokes_existing_session_and_changes_login_credential(ctx):
    _assert_logged_in(ctx)
    new_password = "Replacement-password-67890"
    response = ctx.admin.put(f"/api/admin/users/{ctx.staff.id}/password", json={"password": new_password})
    assert response.status_code == 204, response.text
    assert ctx.client.get("/api/auth/me").status_code == 401
    assert _login(ctx).status_code == 401
    assert _login(ctx, password=new_password).status_code == 200
    assert ctx.client.get(f"/api/guests/{ctx.guests[0].id}").status_code == 200


@pytest.mark.parametrize("changes", [
    {"role": "admin"},
    {"permission_overrides": {"users.manage": True}},
])
def test_management_api_rejects_guest_permission_escalation(ctx, changes):
    response = ctx.admin.patch(f"/api/admin/users/{ctx.staff.id}", json=changes)
    assert response.status_code in {400, 422}, response.text
    ctx.session.refresh(ctx.staff)
    assert ctx.staff.role == "user" and ctx.staff.permission_overrides == {}


def test_guest_time_update_enforced_for_existing_session(ctx):
    _assert_logged_in(ctx)
    response = ctx.admin.patch(f"/api/admin/users/{ctx.staff.id}", json={"access_expires_at": (ctx.now + timedelta(minutes=10)).isoformat()})
    assert response.status_code == 200, response.text
    assert ctx.client.get(f"/api/guests/{ctx.guests[0].id}").status_code == 401


def test_unauthenticated_account_creation_and_cross_site_login_are_rejected(ctx):
    assert ctx.client.post("/api/admin/users", json=_guest_create_body(ctx)).status_code == 401
    response = ctx.client.post("/api/auth/login", json={"identifier": ctx.staff.username, "password": PASSWORD}, headers={"origin": "https://attacker.invalid", "sec-fetch-site": "cross-site"})
    assert response.status_code == 403, response.text
    assert ctx.client.get("/api/auth/me").status_code == 401


@pytest.mark.parametrize("field,value", [
    ("password", "short"), ("username", "invalid-email@"), ("name", "   "),
    ("access_workshop_id", None), ("access_starts_at", None), ("access_expires_at", None),
    ("access_workshop_id", str(uuid.uuid4())),
])
def test_invalid_account_creation_is_atomic(ctx, field, value):
    body = _guest_create_body(ctx)
    body[field] = value
    before = len(ctx.session.scalars(select(AdminUser)).all())
    response = ctx.admin.post("/api/admin/users", json=body)
    assert response.status_code in {400, 422}, response.text
    assert len(ctx.session.scalars(select(AdminUser)).all()) == before


def test_duplicate_email_and_guest_window_validation(ctx):
    body = _guest_create_body(ctx)
    body["username"] = ctx.staff.username.upper()
    assert ctx.admin.post("/api/admin/users", json=body).status_code == 409
    body["username"] = "other-staff"
    body["access_expires_at"] = body["access_starts_at"]
    assert ctx.admin.post("/api/admin/users", json=body).status_code == 400
    body["access_starts_at"] = (ctx.now - timedelta(hours=2)).isoformat()
    body["access_expires_at"] = (ctx.now - timedelta(hours=1)).isoformat()
    assert ctx.admin.post("/api/admin/users", json=body).status_code == 400
    body["access_expires_at"] = (ctx.now + timedelta(hours=1)).replace(tzinfo=None).isoformat()
    assert ctx.admin.post("/api/admin/users", json=body).status_code == 422


def test_guest_scope_management_revokes_session_and_memberships_cannot_expand(ctx):
    _assert_logged_in(ctx)
    rejected = ctx.admin.put(f"/api/admin/workshops/{ctx.workshops[1].id}/members", json={"members": [{"user_id": str(ctx.staff.id), "role": "admin"}]})
    assert rejected.status_code == 400
    response = ctx.admin.patch(f"/api/admin/users/{ctx.staff.id}", json={"access_workshop_id": str(ctx.workshops[1].id)})
    assert response.status_code == 200, response.text
    assert ctx.client.get("/api/auth/me").status_code == 401
    _assert_logged_in(ctx)
    assert ctx.client.get(f"/api/guests/{ctx.guests[0].id}").status_code == 403
    assert ctx.client.get(f"/api/guests/{ctx.guests[1].id}").status_code == 200


@pytest.mark.parametrize("counts,status", [([1, 1], 200), ([11, 1], 429), ([1, 51], 429), (None, 503)])
def test_login_rate_limit_blocks_before_verification(ctx, monkeypatch, counts, status):
    redis = SimpleNamespace(eval=AsyncMock(return_value=counts))
    if counts is None:
        redis.eval.side_effect = RuntimeError("redis unavailable")
    monkeypatch.setattr(local_accounts, "get_redis", lambda: redis)
    monkeypatch.setattr(auth, "check_login_rate_limit", local_accounts.check_login_rate_limit)
    result = _login(ctx)
    assert result.status_code == status, result.text
    if status != 200:
        assert ctx.session.scalar(select(AdminSession).where(AdminSession.user_id == ctx.staff.id)) is None
    if status == 429:
        assert result.headers["Retry-After"] == "900"


def test_lark_directory_cannot_claim_local_or_temporary_accounts(ctx, monkeypatch):
    import asyncio
    from app.services import admin_directory_sync
    # Legacy guests may still retain their old email as metadata. It cannot enable email login.
    ctx.staff.email = "legacy-guest@example.com"
    ctx.session.commit()
    for account in (ctx.local, ctx.staff):
        result = asyncio.run(auth._resolve_login_user(ctx.db, email=account.email, open_id=None, union_id=None))
        assert result is None
    monkeypatch.setattr(admin_directory_sync.lark_client, "list_contact_users", AsyncMock(return_value=[
        {"email": ctx.local.email, "user_id": "new-lark-local", "name": "Overwritten", "status": {"is_frozen": True}},
        {"email": ctx.staff.email, "user_id": "new-lark-guest", "name": "Overwritten", "status": {"is_frozen": True}},
    ]))
    result = asyncio.run(admin_directory_sync.sync_directory(ctx.db))
    assert result.users_skipped == 2
    assert ctx.local.name == "Local editor" and ctx.staff.name == "Check-in staff"
    assert ctx.local.is_active and ctx.staff.is_active
    assert ctx.local.lark_user_id is None and ctx.staff.lark_user_id is None


@pytest.mark.parametrize("value", ["//outside.invalid", "/\\outside.invalid", "/\n/outside.invalid"])
def test_login_redirect_rejects_external_targets(value):
    assert auth._safe_return_to(value) == "/admin"


def test_password_hash_is_salted_and_rejects_malformed_digest(password_hash):
    assert local_accounts.hash_password(PASSWORD) != password_hash
    assert local_accounts.verify_password(PASSWORD, password_hash)
    assert not local_accounts.verify_password(PASSWORD, "scrypt$wrong")


def test_guest_created_without_email_uses_case_insensitive_username(ctx):
    response = ctx.admin.post("/api/admin/users", json=_guest_create_body(ctx, username="  Reception.A_1  "))
    assert response.status_code == 201, response.text
    assert response.json()["email"] is None
    assert response.json()["username"] == "reception.a_1"
    login = ctx.client.post("/api/auth/login", json={"identifier": " RECEPTION.A_1 ", "password": PASSWORD})
    assert login.status_code == 200, login.text
    assert login.json()["username"] == "reception.a_1"
    assert ctx.client.post("/api/auth/login", json={"username": "reception.a_1", "password": PASSWORD}).status_code == 200
    assert ctx.client.get(f"/api/guests/{ctx.guests[1].id}").status_code == 403
    duplicate = ctx.admin.post("/api/admin/users", json=_guest_create_body(ctx, username="Reception.A_1"))
    assert duplicate.status_code == 409


@pytest.mark.parametrize("username", [None, "", "ab", "contains space", "guest@host.com", "đón-khách", ".guest", "a" * 65])
def test_invalid_guest_username_rejected_without_creating_account(ctx, username):
    before = len(ctx.session.scalars(select(AdminUser)).all())
    result = ctx.admin.post("/api/admin/users", json=_guest_create_body(ctx, username=username))
    assert result.status_code == 422, result.text
    assert len(ctx.session.scalars(select(AdminUser)).all()) == before


def test_guest_legacy_email_is_not_a_login_identifier(ctx):
    ctx.staff.email = "old-staff@example.com"
    ctx.session.commit()
    response = ctx.client.post("/api/auth/login", json={"identifier": ctx.staff.email, "password": PASSWORD})
    assert response.status_code == 401
    _assert_logged_in(ctx)


def test_renaming_guest_username_revokes_sessions_and_rejects_previous_name(ctx):
    _assert_logged_in(ctx)
    old_username = ctx.staff.username
    response = ctx.admin.patch(f"/api/admin/users/{ctx.staff.id}", json={"username": " CHECKIN.NEW "})
    assert response.status_code == 200, response.text
    assert response.json()["username"] == "checkin.new"
    assert ctx.client.get("/api/auth/me").status_code == 401
    assert ctx.client.post("/api/auth/login", json={"identifier": old_username, "password": PASSWORD}).status_code == 401
    _assert_logged_in(ctx)
    assert ctx.client.get(f"/api/guests/{ctx.guests[0].id}").status_code == 200
    assert ctx.client.get(f"/api/guests/{ctx.guests[1].id}").status_code == 403


def test_username_uniqueness_on_edit_and_identity_types(ctx):
    ctx.admin.post("/api/admin/users", json=_guest_create_body(ctx, username="reception.second"))
    _assert_logged_in(ctx)
    duplicate = ctx.admin.patch(f"/api/admin/users/{ctx.staff.id}", json={"username": "RECEPTION.SECOND"})
    assert duplicate.status_code == 409
    assert ctx.staff.username == "checkin-staff"
    assert ctx.client.get("/api/auth/me").status_code == 200
    assert ctx.admin.patch(f"/api/admin/users/{ctx.local.id}", json={"username": "new-local"}).status_code == 400
    assert ctx.admin.post("/api/admin/users", json=_guest_create_body(ctx, email="email-not-used@example.com")).status_code == 422
    assert ctx.admin.post("/api/admin/users", json={"name":"Local", "username":"local-only", "password":PASSWORD, "account_type":"local"}).status_code == 422
    # Old clients may continue submitting an email for ordinary local accounts.
    response = ctx.client.post("/api/auth/login", json={"email": ctx.local.email, "password": PASSWORD})
    assert response.status_code == 200


def _walk_in(**changes):
    return {"full_name": "Walk-in attendee", "phone": "0901234567", "business_model": "Quán trà",
            "source": "Khác", "source_detail": "Khách vãng lai", "party_size": 2, **changes}


def test_guest_can_add_attendee_only_in_assigned_workshop(ctx, monkeypatch):
    from app.services import zalo_messages
    monkeypatch.setattr(zalo_messages, "enqueue_auto_send_new_guest", AsyncMock())
    _assert_logged_in(ctx)
    created = ctx.client.post(f"/api/workshops/{ctx.workshops[0].id}/guests", json=_walk_in())
    assert created.status_code == 201, created.text
    row = ctx.session.get(Guest, uuid.UUID(created.json()["id"]))
    assert row.workshop_id == ctx.workshops[0].id
    assert row.creator_user_id == ctx.staff.id and row.creator_name == "Check-in staff"
    assert ctx.client.post(f"/api/workshops/{ctx.workshops[1].id}/guests", json=_walk_in(phone="0907654321")).status_code == 403
    # Adding does not unlock editing, including the attendee the account just created.
    assert ctx.client.patch(f"/api/guests/{row.id}", json={"full_name": "Renamed"}).status_code == 403
    duplicate = ctx.client.post(f"/api/workshops/{ctx.workshops[0].id}/guests", json=_walk_in())
    assert duplicate.status_code == 409


def test_guest_cannot_add_attendee_outside_access_window(ctx):
    _assert_logged_in(ctx)
    ctx.staff.access_expires_at = ctx.now - timedelta(seconds=1)
    ctx.session.commit()
    response = ctx.client.post(f"/api/workshops/{ctx.workshops[0].id}/guests", json=_walk_in())
    assert response.status_code == 401
    assert ctx.session.scalar(select(Guest).where(Guest.full_name == "Walk-in attendee")) is None


def test_viewer_role_still_cannot_add_attendee(ctx):
    _assert_logged_in(ctx, ctx.local)  # editor at workshop A, viewer at workshop B
    response = ctx.client.post(f"/api/workshops/{ctx.workshops[1].id}/guests", json=_walk_in())
    assert response.status_code == 403
