from datetime import datetime, timezone
from ipaddress import ip_address
import uuid

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import AdminSession, AdminUser, GuestCreatorAlias
from ..auth.session import token_hash


GUEST_SOURCE_OPTIONS = {
    "Đại lý giới thiệu",
    "Bài viết trên Mạng xã hội Facebook, Zalo, Tiktok",
    "Thông tin trên hội nhóm Facebook, Zalo",
    "Quảng cáo trên Facebook, Zalo, Tiktok",
    "Khác",
}


def normalize_guest_source(source: str, source_detail: str | None) -> tuple[str, str | None]:
    normalized_source = (source or "").strip()
    if normalized_source not in GUEST_SOURCE_OPTIONS:
        raise HTTPException(400, "Vui lòng chọn nguồn thông tin hợp lệ")
    normalized_detail = (source_detail or "").strip() or None
    if normalized_source == "Khác" and not normalized_detail:
        raise HTTPException(400, "Vui lòng ghi rõ nguồn thông tin")
    return normalized_source, normalized_detail if normalized_source == "Khác" else None


def client_ip(request: Request) -> str:
    candidates = [
        *(part.strip() for part in (request.headers.get("x-forwarded-for") or "").split(",")),
        (request.headers.get("x-real-ip") or "").strip(),
        request.client.host if request.client else "",
    ]
    for candidate in candidates:
        if not candidate:
            continue
        try:
            return str(ip_address(candidate))
        except ValueError:
            continue
    return "unknown"


async def optional_admin_user(request: Request, db: AsyncSession) -> AdminUser | None:
    token = request.cookies.get(settings.AUTH_SESSION_COOKIE)
    if not token:
        return None
    return (await db.execute(
        select(AdminUser)
        .join(AdminSession, AdminSession.user_id == AdminUser.id)
        .where(
            AdminSession.token_hash == token_hash(token),
            AdminSession.expires_at > datetime.now(timezone.utc),
            AdminUser.is_active.is_(True),
        )
    )).scalar_one_or_none()


async def resolve_public_creator(
    request: Request,
    db: AsyncSession,
) -> tuple[str, uuid.UUID | None]:
    user = await optional_admin_user(request, db)
    if user:
        return user.name or user.email, user.id

    ip_address = client_ip(request)
    await db.execute(
        insert(GuestCreatorAlias)
        .values(ip_address=ip_address)
        .on_conflict_do_nothing(index_elements=[GuestCreatorAlias.ip_address])
    )
    alias_number = (await db.execute(
        select(GuestCreatorAlias.alias_number).where(
            GuestCreatorAlias.ip_address == ip_address
        )
    )).scalar_one()
    return f"Người dùng {alias_number}", None
