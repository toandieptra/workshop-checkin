import asyncio
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import dependencies, workshop_access
from app.auth.dependencies import current_user
from app.auth.permissions import PERMISSIONS, effective_permissions
from app.db import get_db
from app.models import AdminUser, Workshop, WorkshopMember
from app.routers import admin_workshops


def user(role="user", **kwargs):
    return AdminUser(id=uuid.uuid4(), email="scope-test@example.test", role=role,
                     is_active=True, permission_overrides={}, **kwargs)


def result(*, scalar=None, rows=()):
    value = MagicMock()
    value.scalar_one_or_none.return_value = scalar
    value.scalars.return_value.all.return_value = list(rows)
    return value


async def default_grants(db, role, overrides=None):
    return effective_permissions(role, overrides)


@pytest.fixture(autouse=True)
def use_role_catalog(monkeypatch):
    monkeypatch.setattr(workshop_access, "effective_permissions_for_user", default_grants)
    monkeypatch.setattr(dependencies, "effective_permissions_for_user", default_grants)


def test_editor_a_viewer_b_and_no_c_never_share_grants():
    actor = user()
    workshop_a, workshop_b, workshop_c = (uuid.uuid4() for _ in range(3))
    db = AsyncMock(spec=AsyncSession)
    db.execute.side_effect = [result(scalar="editor"), result(scalar="viewer"), result()]

    async def run():
        await workshop_access.require_workshop_permission(db, actor, workshop_a, "guests.write")
        for workshop_id in (workshop_b, workshop_c):
            with pytest.raises(HTTPException) as error:
                await workshop_access.require_workshop_permission(db, actor, workshop_id, "guests.write")
            assert error.value.status_code == 403
    asyncio.run(run())


def test_override_does_not_create_membership_and_global_grants_do_not_leak():
    actor = user("editor")
    actor.permission_overrides = {"guests.write": True}
    db = AsyncMock(spec=AsyncSession)
    db.execute.return_value = result()
    assert asyncio.run(workshop_access.workshop_permissions(db, actor, uuid.uuid4())) == set()


def test_workshop_admin_does_not_grant_global_management():
    actor = user()
    db = AsyncMock(spec=AsyncSession)
    db.execute.return_value = result(scalar="admin")
    grants = asyncio.run(workshop_access.workshop_permissions(db, actor, uuid.uuid4()))
    assert "workshops.delete" in grants
    assert "users.manage" not in grants
    assert "zalo_connections.manage" not in grants
    assert "zalo_templates.manage" not in grants
    assert not workshop_access.is_global_workshop_admin(actor)


@pytest.mark.parametrize("role", ["admin", "super_admin"])
def test_global_admin_bypasses_membership_but_keeps_functional_denials(role):
    actor = user(role)
    actor.permission_overrides = {"guests.write": False}
    db = AsyncMock(spec=AsyncSession)
    grants = asyncio.run(workshop_access.workshop_permissions(db, actor, uuid.uuid4()))
    assert "guests.read" in grants
    assert "guests.write" not in grants
    assert asyncio.run(workshop_access.allowed_workshop_ids(db, actor, "guests.read")) is None
    assert asyncio.run(workshop_access.allowed_workshop_ids(db, actor, "guests.write")) == set()
    db.execute.assert_not_awaited()


def test_scoped_overrides_apply_inside_membership_only():
    actor = user()
    actor.permission_overrides = {"guests.write": True, "guests.read": False, "users.manage": True}
    db = AsyncMock(spec=AsyncSession)
    db.execute.return_value = result(scalar="viewer")
    grants = asyncio.run(workshop_access.workshop_permissions(db, actor, uuid.uuid4()))
    assert "guests.write" in grants
    assert "guests.read" not in grants
    assert "users.manage" not in grants


def test_revoking_membership_takes_effect_without_new_session():
    actor = user()
    db = AsyncMock(spec=AsyncSession)
    db.execute.side_effect = [result(scalar="editor"), result()]
    workshop_id = uuid.uuid4()
    assert "guests.write" in asyncio.run(workshop_access.workshop_permissions(db, actor, workshop_id))
    assert asyncio.run(workshop_access.workshop_permissions(db, actor, workshop_id)) == set()


def test_custom_role_updates_are_not_cached(monkeypatch):
    stored = {"guests.read", "guests.write", "users.manage"}

    async def custom_grants(db, role, overrides):
        assert role == "coordinator"
        return set(stored)

    monkeypatch.setattr(workshop_access, "effective_permissions_for_user", custom_grants)
    actor = user()
    db = AsyncMock(spec=AsyncSession)
    db.execute.return_value = result(scalar="coordinator")
    workshop_id = uuid.uuid4()
    assert asyncio.run(workshop_access.workshop_permissions(db, actor, workshop_id)) == {"guests.read", "guests.write"}
    stored.remove("guests.write")
    assert asyncio.run(workshop_access.workshop_permissions(db, actor, workshop_id)) == {"guests.read"}


def test_allowed_ids_are_permission_specific_and_payload_keeps_roles_separate():
    actor = user()
    a = WorkshopMember(user_id=actor.id, workshop_id=uuid.uuid4(), role="editor")
    b = WorkshopMember(user_id=actor.id, workshop_id=uuid.uuid4(), role="viewer")
    db = AsyncMock(spec=AsyncSession)
    db.execute.return_value = result(rows=[a, b])
    assert asyncio.run(workshop_access.allowed_workshop_ids(db, actor, "guests.write")) == {a.workshop_id}
    assert asyncio.run(workshop_access.allowed_workshop_ids(db, actor, "guests.read")) == {a.workshop_id, b.workshop_id}
    payload = asyncio.run(workshop_access.workshop_access_payload(db, actor))
    assert [entry["role"] for entry in payload] == ["editor", "viewer"]
    assert "guests.write" not in payload[1]["permissions"]


def test_inactive_account_has_no_workshop_permissions():
    actor = user("super_admin")
    actor.is_active = False
    db = AsyncMock(spec=AsyncSession)
    assert asyncio.run(workshop_access.workshop_permissions(db, actor, uuid.uuid4())) == set()
    assert asyncio.run(workshop_access.allowed_workshop_ids(db, actor, "guests.read")) == set()
    db.execute.assert_not_awaited()


def request(db, actor, method, path, payload=None):
    app = FastAPI()
    app.include_router(admin_workshops.router)

    async def database():
        yield db

    app.dependency_overrides[get_db] = database
    if actor is not None:
        app.dependency_overrides[current_user] = lambda: actor

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as client:
            return await client.request(method, path, json=payload)
    return asyncio.run(run())


def test_membership_catalog_requires_authentication():
    response = request(AsyncMock(spec=AsyncSession), None, "GET", "/api/admin/workshops")
    assert response.status_code == 401


@pytest.mark.parametrize("role", ["user", "viewer", "editor", "admin"])
def test_membership_management_requires_global_users_manage(role):
    db = AsyncMock(spec=AsyncSession)
    response = request(db, user(role), "PUT", f"/api/admin/workshops/{uuid.uuid4()}/members", {"members": []})
    assert response.status_code == 403
    db.execute.assert_not_awaited()
    db.commit.assert_not_awaited()


@pytest.mark.parametrize("case", ["duplicate", "super_admin", "missing_user", "inherited_admin", "invalid_role"])
def test_invalid_replacement_leaves_memberships_untouched(case):
    workshop_id = uuid.uuid4()
    actor = user("super_admin")
    member = user()
    assignment = {"user_id": str(member.id), "role": "viewer"}
    entries = [assignment]
    db = AsyncMock(spec=AsyncSession)
    responses = [result(scalar=Workshop(id=workshop_id))]
    if case == "duplicate":
        entries.append(dict(assignment))
    elif case == "super_admin":
        assignment["role"] = "super_admin"
    elif case == "missing_user":
        responses.append(result(rows=[]))
    elif case == "inherited_admin":
        member.role = "admin"
        responses.append(result(rows=[member]))
    else:
        assignment["role"] = "does_not_exist"
        responses.extend([result(rows=[member]), result(rows=[])])
    db.execute.side_effect = responses
    response = request(db, actor, "PUT", f"/api/admin/workshops/{workshop_id}/members", {"members": entries})
    assert response.status_code == 400, response.text
    db.add.assert_not_called()
    db.commit.assert_not_awaited()
    assert all(not call.args[0].is_delete for call in db.execute.call_args_list)


def test_atomic_replacement_can_assign_inactive_account_without_activating_it():
    workshop_id = uuid.uuid4()
    actor = user("super_admin")
    member = user()
    member.is_active = False
    stored = WorkshopMember(user_id=member.id, workshop_id=workshop_id, role="editor")
    db = AsyncMock(spec=AsyncSession)
    db.execute.side_effect = [
        result(scalar=Workshop(id=workshop_id)), result(rows=[member]), result(rows=["editor"]),
        result(), result(rows=[actor.id]), result(rows=[stored]),
    ]
    response = request(db, actor, "PUT", f"/api/admin/workshops/{workshop_id}/members", {
        "members": [{"user_id": str(member.id), "role": "editor"}],
    })
    assert response.status_code == 200, response.text
    assert response.json() == {
        "members": [{"user_id": str(member.id), "role": "editor"}],
        "inherited_user_ids": [str(actor.id)],
    }
    assert member.is_active is False
    assert db.add.call_args.args[0].workshop_id == workshop_id
    db.commit.assert_awaited_once()


def test_scoped_poll_denies_other_workshop_before_reading_events():
    db = AsyncMock(spec=AsyncSession)
    db.execute.return_value = result()
    response = request(db, user(), "GET", f"/api/admin/workshops/{uuid.uuid4()}/welcome/latest")
    assert response.status_code == 403
    db.execute.assert_awaited_once()


def test_scoped_poll_allows_local_viewer_without_global_guest_permission():
    db = AsyncMock(spec=AsyncSession)
    db.execute.side_effect = [result(scalar="viewer"), result()]
    response = request(db, user(), "GET", f"/api/admin/workshops/{uuid.uuid4()}/welcome/latest")
    assert response.status_code == 200
    assert response.json() is None
