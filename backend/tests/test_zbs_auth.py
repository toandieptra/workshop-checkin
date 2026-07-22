import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import httpx

from app.models import ZbsOAuthCredential
from app.services.zbs_auth import (
    _access_token_valid,
    _credential,
    _requires_reauthorization,
    is_token_error,
    refresh_access_token,
    request_with_token,
)


def _response(payload: dict, status: int = 200) -> httpx.Response:
    return httpx.Response(status, json=payload, request=httpx.Request("GET", "https://zalo.test"))


def test_access_token_valid_uses_expiry_buffer():
    valid = ZbsOAuthCredential(
        id=1,
        access_token="valid",
        access_token_expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
    )
    expiring = ZbsOAuthCredential(
        id=1,
        access_token="expiring",
        access_token_expires_at=datetime.now(timezone.utc) + timedelta(minutes=4),
    )

    assert _access_token_valid(valid)
    assert not _access_token_valid(expiring)


def test_detects_zalo_token_error_inside_successful_http_response():
    assert is_token_error(_response({"error": -124, "message": "Access token invalid"}))
    assert not is_token_error(_response({"error": 0, "data": {}}))


def test_only_refresh_token_errors_require_reauthorization():
    assert _requires_reauthorization("Refresh token invalid")
    assert _requires_reauthorization("Refresh Token đã hết hạn")
    assert not _requires_reauthorization("Zalo OAuth request timeout")


def test_invalid_database_refresh_token_is_reseeded_from_environment():
    credential = ZbsOAuthCredential(
        id=1,
        access_token="old-access",
        refresh_token="old-refresh",
        last_refresh_error="Không thể làm mới token Zalo: Invalid refresh token.",
    )
    db = AsyncMock()
    db.scalar = AsyncMock(return_value=credential)

    with (
        patch("app.services.zbs_auth.settings.ZBS_ACCESS_TOKEN", "new-access"),
        patch("app.services.zbs_auth.settings.ZBS_REFRESH_TOKEN", "new-refresh"),
    ):
        result = asyncio.run(_credential(db))

    assert result.access_token == "new-access"
    assert result.refresh_token == "new-refresh"
    assert result.last_refresh_error is None
    db.commit.assert_awaited_once()


def test_healthy_rotated_refresh_token_is_not_overwritten_by_environment():
    credential = ZbsOAuthCredential(
        id=1,
        access_token="rotated-access",
        refresh_token="rotated-refresh",
    )
    db = AsyncMock()
    db.scalar = AsyncMock(return_value=credential)

    with patch("app.services.zbs_auth.settings.ZBS_REFRESH_TOKEN", "bootstrap-refresh"):
        result = asyncio.run(_credential(db))

    assert result.refresh_token == "rotated-refresh"
    db.commit.assert_not_awaited()


def test_token_error_refreshes_and_retries_once():
    db = AsyncMock()
    client = AsyncMock()
    client.request = AsyncMock(side_effect=[
        _response({"error": -124, "message": "Access token invalid"}),
        _response({"error": 0, "data": {"ok": True}}),
    ])

    with (
        patch("app.services.zbs_auth.get_access_token", AsyncMock(return_value="old-token")),
        patch("app.services.zbs_auth.refresh_access_token", AsyncMock(return_value="new-token")) as refresh,
    ):
        response = asyncio.run(request_with_token(db, client, "GET", "https://zalo.test"))

    assert response.json()["error"] == 0
    assert client.request.await_count == 2
    assert client.request.await_args_list[0].kwargs["headers"]["access_token"] == "old-token"
    assert client.request.await_args_list[1].kwargs["headers"]["access_token"] == "new-token"
    refresh.assert_awaited_once_with(db, force=True, expected_access_token="old-token")


def test_refresh_rotates_and_persists_both_tokens():
    credential = ZbsOAuthCredential(id=1, access_token="old-access", refresh_token="old-refresh")
    db = AsyncMock()
    response = _response({
        "access_token": "new-access",
        "refresh_token": "new-refresh",
        "expires_in": "90000",
    })
    client = AsyncMock()
    client.post = AsyncMock(return_value=response)
    client.__aenter__.return_value = client

    with (
        patch("app.services.zbs_auth._credential", AsyncMock(return_value=credential)),
        patch("app.services.zbs_auth.httpx.AsyncClient", return_value=client),
        patch("app.services.zbs_auth.settings.ZBS_APP_ID", "app-id"),
        patch("app.services.zbs_auth.settings.ZBS_APP_SECRET", "app-secret"),
    ):
        token = asyncio.run(refresh_access_token(db, force=True))

    assert token == "new-access"
    assert credential.access_token == "new-access"
    assert credential.refresh_token == "new-refresh"
    assert credential.access_token_expires_at > datetime.now(timezone.utc) + timedelta(hours=24)
    db.commit.assert_awaited_once()
    assert client.post.await_args.kwargs["headers"]["secret_key"] == "app-secret"
    assert client.post.await_args.kwargs["data"]["refresh_token"] == "old-refresh"
