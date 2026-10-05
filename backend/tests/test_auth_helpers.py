import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException, Request, Response

from app.auth.session import token_hash
from app.models import AdminSession, AdminUser
from app.routers.admin_users import _session_payload, list_user_sessions, revoke_user_session
from app.routers.auth import _safe_return_to


def test_session_token_is_hashed_deterministically():
    assert token_hash("secret") != "secret"
    assert token_hash("secret") == token_hash("secret")


def test_return_to_only_allows_local_paths():
    assert _safe_return_to("/admin/users") == "/admin/users"
    assert _safe_return_to("https://evil.example") == "/admin"
    assert _safe_return_to("//evil.example") == "/admin"


def test_session_payload_marks_current_active_session_without_exposing_token():
    now = datetime.now(timezone.utc)
    session = AdminSession(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        token_hash=token_hash("secret"),
        created_at=now - timedelta(minutes=5),
        last_seen_at=now - timedelta(minutes=1),
        expires_at=now + timedelta(hours=1),
        user_agent="Mozilla/5.0",
        ip_address="192.0.2.10",
    )

    payload = _session_payload(session, current_token_hash=token_hash("secret"), now=now)

    assert payload["id"] == str(session.id)
    assert payload["user_id"] == str(session.user_id)
    assert payload["is_current"] is True
    assert payload["is_active"] is True
    assert payload["status"] == "active"
    assert payload["user_agent"] == "Mozilla/5.0"
    assert payload["ip_address"] == "192.0.2.10"
    assert "token_hash" not in payload


def test_session_payload_marks_sessions_inactive_when_account_is_disabled():
    now = datetime.now(timezone.utc)
    session = AdminSession(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        token_hash=token_hash("active"),
        expires_at=now + timedelta(hours=1),
    )

    payload = _session_payload(session, current_token_hash=None, now=now, account_active=False)

    assert payload["is_active"] is False
    assert payload["status"] == "expired"


def test_session_payload_handles_expired_naive_timestamp():
    now = datetime.now(timezone.utc)
    session = AdminSession(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        token_hash=token_hash("old"),
        expires_at=(now - timedelta(seconds=1)).replace(tzinfo=None),
    )

    payload = _session_payload(session, current_token_hash=None, now=now)

    assert payload["is_current"] is False
    assert payload["is_active"] is False
    assert payload["status"] == "expired"


def test_list_user_sessions_marks_cookie_session_as_current():
    user_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    session = AdminSession(
        id=uuid.uuid4(),
        user_id=user_id,
        token_hash=token_hash("current"),
        expires_at=now + timedelta(hours=1),
    )
    query_result = MagicMock()
    query_result.scalars.return_value.all.return_value = [session]
    db = AsyncMock()
    db.get.return_value = AdminUser(id=user_id, email="admin@example.com", role="admin", is_active=True)
    db.execute.return_value = query_result
    request = Request({
        "type": "http",
        "method": "GET",
        "path": f"/api/admin/users/{user_id}/sessions",
        "headers": [(b"cookie", b"workshop_admin_session=current")],
        "query_string": b"",
        "server": ("testserver", 80),
        "client": ("127.0.0.1", 1234),
        "scheme": "http",
    })

    payload = asyncio.run(list_user_sessions(user_id, request, db, None))

    assert len(payload) == 1
    assert payload[0]["is_current"] is True
    assert payload[0]["is_active"] is True
    assert payload[0]["status"] == "active"
    assert payload[0]["user_id"] == str(user_id)


def test_revoke_user_session_rejects_missing_session_without_mutating_db():
    user_id = uuid.uuid4()
    session_id = uuid.uuid4()
    query_result = MagicMock()
    query_result.scalar_one_or_none.return_value = None
    db = AsyncMock()
    db.get.return_value = AdminUser(id=user_id, email="admin@example.com", role="admin", is_active=True)
    db.execute.return_value = query_result
    request = Request({
        "type": "http",
        "method": "DELETE",
        "path": f"/api/admin/users/{user_id}/sessions/{session_id}",
        "headers": [],
        "query_string": b"",
        "server": ("testserver", 80),
        "client": ("127.0.0.1", 1234),
        "scheme": "http",
    })

    with pytest.raises(HTTPException) as exc:
        asyncio.run(revoke_user_session(user_id, session_id, request, Response(), db, None))

    assert exc.value.status_code == 404
    db.delete.assert_not_awaited()
    db.commit.assert_not_awaited()


def test_revoke_current_user_session_deletes_row_and_clears_cookie():
    user_id = uuid.uuid4()
    session = AdminSession(
        id=uuid.uuid4(),
        user_id=user_id,
        token_hash=token_hash("current"),
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    query_result = MagicMock()
    query_result.scalar_one_or_none.return_value = session
    db = AsyncMock()
    db.get.return_value = AdminUser(id=user_id, email="admin@example.com", role="admin")
    db.execute.return_value = query_result
    request = Request({
        "type": "http",
        "method": "DELETE",
        "path": f"/api/admin/users/{user_id}/sessions/{session.id}",
        "headers": [(b"cookie", b"workshop_admin_session=current")],
        "query_string": b"",
        "server": ("testserver", 80),
        "client": ("127.0.0.1", 1234),
        "scheme": "http",
    })
    response = Response()

    asyncio.run(revoke_user_session(user_id, session.id, request, response, db, None))

    db.delete.assert_awaited_once_with(session)
    db.commit.assert_awaited_once()
    assert any(name.lower() == b"set-cookie" and b"workshop_admin_session=" in value and b"Max-Age=0" in value for name, value in response.raw_headers)
