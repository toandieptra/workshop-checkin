import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Request, Response
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import AdminSession, AdminUser


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def create_session(db: AsyncSession, user: AdminUser, request: Request) -> str:
    token = secrets.token_urlsafe(48)
    forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    db.add(AdminSession(
        user_id=user.id,
        token_hash=token_hash(token),
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=settings.AUTH_SESSION_TTL_SECONDS),
        user_agent=request.headers.get("user-agent"),
        ip_address=forwarded or (request.client.host if request.client else None),
    ))
    await db.commit()
    return token


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        settings.AUTH_SESSION_COOKIE,
        token,
        max_age=settings.AUTH_SESSION_TTL_SECONDS,
        httponly=True,
        secure=settings.AUTH_COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(settings.AUTH_SESSION_COOKIE, path="/", samesite="lax")


async def revoke_session(db: AsyncSession, token: str | None) -> None:
    if token:
        await db.execute(delete(AdminSession).where(AdminSession.token_hash == token_hash(token)))
        await db.commit()
