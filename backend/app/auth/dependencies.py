from datetime import datetime, timezone
from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_db
from ..models import AdminSession, AdminUser
from .permissions import effective_permissions_for_user
from .session import token_hash


async def current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
    session_token: Annotated[str | None, Cookie(alias=settings.AUTH_SESSION_COOKIE)] = None,
) -> AdminUser:
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        fetch_site = request.headers.get("sec-fetch-site", "")
        if fetch_site == "cross-site":
            raise HTTPException(403, "cross-site request rejected")
        origin = request.headers.get("origin")
        if origin:
            forwarded_proto = request.headers.get("x-forwarded-proto") or request.url.scheme
            forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
            expected_origin = f"{forwarded_proto}://{forwarded_host}"
            if origin.rstrip("/") != expected_origin.rstrip("/"):
                raise HTTPException(403, "invalid request origin")
    if not session_token:
        raise HTTPException(401, "authentication required")
    row = (await db.execute(
        select(AdminUser, AdminSession)
        .join(AdminSession, AdminSession.user_id == AdminUser.id)
        .where(AdminSession.token_hash == token_hash(session_token))
    )).one_or_none()
    if not row:
        raise HTTPException(401, "invalid session")
    user, session = row
    now = datetime.now(timezone.utc)
    if session.expires_at <= now or not user.is_active:
        await db.delete(session)
        await db.commit()
        raise HTTPException(401, "session expired or user inactive")
    session.last_seen_at = now
    await db.commit()
    return user


def require_permission(permission: str):
    async def dependency(
        user: AdminUser = Depends(current_user),
        db: AsyncSession = Depends(get_db),
    ) -> AdminUser:
        if permission not in await effective_permissions_for_user(db, user.role, user.permission_overrides):
            raise HTTPException(403, f"missing permission: {permission}")
        return user
    return dependency
