from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import ZbsOAuthCredential

TOKEN_URL = "https://oauth.zaloapp.com/v4/oa/access_token"
CONNECTION_TEST_URL = "https://business.openapi.zalo.me/template/all"
TOKEN_REFRESH_BUFFER = timedelta(minutes=5)
TOKEN_ERROR_CODES = {-124, -216, -14005}


class ZbsAuthError(RuntimeError):
    pass


def is_token_error(response: httpx.Response) -> bool:
    if response.status_code == 401:
        return True
    try:
        payload = response.json()
    except ValueError:
        return False
    error = payload.get("error")
    message = str(payload.get("message") or "").lower()
    return error in TOKEN_ERROR_CODES or "access token" in message and (
        "invalid" in message or "expired" in message
    )


async def _credential(db: AsyncSession, *, for_update: bool = False) -> ZbsOAuthCredential:
    query = select(ZbsOAuthCredential).where(ZbsOAuthCredential.id == 1)
    if for_update:
        query = query.with_for_update()
    credential = await db.scalar(query)
    if credential is None:
        credential = ZbsOAuthCredential(
            id=1,
            access_token=settings.ZBS_ACCESS_TOKEN,
            refresh_token=settings.ZBS_REFRESH_TOKEN,
        )
        db.add(credential)
        await db.commit()
        if for_update:
            credential = await db.scalar(query)
    elif not credential.refresh_token and settings.ZBS_REFRESH_TOKEN:
        credential.refresh_token = settings.ZBS_REFRESH_TOKEN
        credential.updated_at = datetime.now(timezone.utc)
        await db.commit()
        if for_update:
            credential = await db.scalar(query)
    return credential


def _access_token_valid(credential: ZbsOAuthCredential) -> bool:
    if not credential.access_token:
        return False
    if credential.access_token_expires_at is None:
        return True
    expires_at = credential.access_token_expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at > datetime.now(timezone.utc) + TOKEN_REFRESH_BUFFER


def _requires_reauthorization(error: str | None) -> bool:
    message = (error or "").lower()
    return "refresh token" in message and any(value in message for value in ("invalid", "expired", "revoked", "không hợp lệ", "hết hạn"))


async def refresh_access_token(
    db: AsyncSession,
    *,
    force: bool = False,
    expected_access_token: str | None = None,
) -> str:
    credential = await _credential(db, for_update=True)
    if force and expected_access_token and credential.access_token != expected_access_token:
        return str(credential.access_token)
    if not force and _access_token_valid(credential):
        return str(credential.access_token)
    if not settings.ZBS_APP_ID or not settings.ZBS_APP_SECRET or not credential.refresh_token:
        await db.rollback()
        raise ZbsAuthError("Thiếu ZBS_APP_ID, ZBS_APP_SECRET hoặc ZBS_REFRESH_TOKEN")

    try:
        async with httpx.AsyncClient(timeout=settings.ZBS_REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.post(
                TOKEN_URL,
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "secret_key": settings.ZBS_APP_SECRET,
                },
                data={
                    "app_id": settings.ZBS_APP_ID,
                    "grant_type": "refresh_token",
                    "refresh_token": credential.refresh_token,
                },
            )
        try:
            payload = response.json()
        except ValueError as exc:
            raise ZbsAuthError(f"Zalo OAuth trả về HTTP {response.status_code} không hợp lệ") from exc
        data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
        access_token = data.get("access_token")
        refresh_token = data.get("refresh_token")
        if not response.is_success or payload.get("error") not in (None, 0) or not access_token:
            message = payload.get("error_name") or payload.get("message") or f"HTTP {response.status_code}"
            raise ZbsAuthError(f"Không thể làm mới token Zalo: {message}")
        try:
            expires_in = int(data.get("expires_in") or 90000)
        except (TypeError, ValueError):
            expires_in = 90000

        now = datetime.now(timezone.utc)
        credential.access_token = str(access_token)
        if refresh_token:
            credential.refresh_token = str(refresh_token)
        credential.access_token_expires_at = now + timedelta(seconds=expires_in)
        credential.last_refreshed_at = now
        credential.last_refresh_error = None
        credential.updated_at = now
        await db.commit()
        return credential.access_token
    except Exception as exc:
        await db.rollback()
        credential = await _credential(db, for_update=True)
        credential.last_refresh_error = str(exc)
        credential.updated_at = datetime.now(timezone.utc)
        await db.commit()
        if isinstance(exc, ZbsAuthError):
            raise
        raise ZbsAuthError(f"Không thể làm mới token Zalo: {exc}") from exc


async def get_access_token(db: AsyncSession) -> str:
    credential = await _credential(db)
    if _access_token_valid(credential):
        return str(credential.access_token)
    return await refresh_access_token(db)


async def oauth_status(db: AsyncSession) -> dict:
    credential = await _credential(db)
    configured = bool(settings.ZBS_APP_ID and settings.ZBS_APP_SECRET and credential.refresh_token)
    if not configured:
        status = "not_configured"
    elif credential.last_refresh_error:
        status = "reauthorization_required" if _requires_reauthorization(credential.last_refresh_error) else "refresh_failed"
    elif not credential.access_token:
        status = "refresh_failed"
    elif not _access_token_valid(credential):
        status = "expiring"
    else:
        status = "connected"
    return {
        "status": status,
        "configured": configured,
        "access_token_expires_at": credential.access_token_expires_at,
        "last_refreshed_at": credential.last_refreshed_at,
        "last_refresh_error": credential.last_refresh_error,
    }


async def test_connection(db: AsyncSession) -> dict:
    async with httpx.AsyncClient(timeout=settings.ZBS_REQUEST_TIMEOUT_SECONDS) as client:
        response = await request_with_token(
            db,
            client,
            "GET",
            CONNECTION_TEST_URL,
            params={"offset": 0, "limit": 1, "filterPreset": 0},
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise ZbsAuthError(f"Zalo trả về HTTP {response.status_code} không hợp lệ") from exc
    if not response.is_success or payload.get("error") not in (None, 0):
        message = payload.get("message") or f"HTTP {response.status_code}"
        raise ZbsAuthError(f"Không thể kết nối Zalo: {message}")
    return await oauth_status(db)


async def request_with_token(
    db: AsyncSession,
    client: httpx.AsyncClient,
    method: str,
    url: str,
    **kwargs,
) -> httpx.Response:
    token = await get_access_token(db)
    headers = {**kwargs.pop("headers", {}), "access_token": token}
    response = await client.request(method, url, headers=headers, **kwargs)
    if not is_token_error(response):
        return response
    token = await refresh_access_token(db, force=True, expected_access_token=token)
    retry_headers = {**headers, "access_token": token}
    return await client.request(method, url, headers=retry_headers, **kwargs)
