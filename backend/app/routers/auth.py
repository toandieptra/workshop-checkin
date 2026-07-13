import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import current_user
from ..auth.lark_oauth import LarkOAuthError, authorization_url, exchange_code
from ..auth.permissions import effective_permissions_for_user
from ..auth.session import clear_session_cookie, create_session, revoke_session, set_session_cookie, token_hash
from ..config import settings
from ..db import get_db
from ..models import AdminOAuthState, AdminUser

router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger("auth")


async def _user_payload(user: AdminUser, db: AsyncSession) -> dict:
    return {
        "id": str(user.id), "email": user.email, "name": user.name,
        "avatar_url": user.avatar_url, "role": user.role, "is_active": user.is_active,
        "permissions": sorted(await effective_permissions_for_user(db, user.role, user.permission_overrides)),
        "permission_overrides": user.permission_overrides or {},
    }


def _safe_return_to(value: str | None) -> str:
    return value if value and value.startswith("/") and not value.startswith("//") else "/admin"


@router.get("/lark/login")
async def lark_login(return_to: str | None = Query(default="/admin"), db: AsyncSession = Depends(get_db)):
    state = secrets.token_urlsafe(32)
    db.add(AdminOAuthState(
        state_hash=hashlib.sha256(state.encode()).hexdigest(),
        return_to=_safe_return_to(return_to),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
    ))
    await db.commit()
    try:
        return RedirectResponse(authorization_url(state), status_code=302)
    except LarkOAuthError as exc:
        raise HTTPException(503, str(exc))


@router.get("/lark/callback")
async def lark_callback(code: str, state: str, request: Request, db: AsyncSession = Depends(get_db)):
    state_hash = hashlib.sha256(state.encode()).hexdigest()
    oauth_state = (await db.execute(
        select(AdminOAuthState).where(AdminOAuthState.state_hash == state_hash)
    )).scalar_one_or_none()
    if not oauth_state or oauth_state.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(400, "invalid or expired OAuth state")
    return_to = _safe_return_to(oauth_state.return_to)
    await db.delete(oauth_state)
    await db.commit()
    try:
        profile = await exchange_code(code)
    except Exception as exc:
        raise HTTPException(502, f"Lark OAuth failed: {exc}")

    email = (profile.get("email") or profile.get("enterprise_email") or "").strip().lower()
    tenant_key = (profile.get("tenant_key") or "").strip()
    if not email:
        raise HTTPException(403, "Lark account has no email")
    allowed = settings.lark_allowed_tenant_keys
    if allowed and tenant_key not in allowed:
        logger.warning(
            "Rejected Lark login for tenant_key=%s; configured allowlist=%s",
            tenant_key or "<missing>",
            ",".join(sorted(allowed)),
        )
        raise HTTPException(403, "Lark tenant is not allowed")

    open_id = profile.get("open_id")
    union_id = profile.get("union_id")
    user = (await db.execute(select(AdminUser).where(or_(
        func.lower(AdminUser.email) == email,
        AdminUser.lark_open_id == open_id if open_id else False,
        AdminUser.lark_union_id == union_id if union_id else False,
    )))).scalars().first()
    if not user or not user.is_active:
        raise HTTPException(403, "account is not pre-provisioned or is inactive")
    user.email = email
    user.name = profile.get("name") or profile.get("en_name") or user.name
    user.avatar_url = profile.get("avatar_url") or profile.get("avatar_big") or user.avatar_url
    user.lark_open_id = open_id or user.lark_open_id
    user.lark_union_id = union_id or user.lark_union_id
    user.lark_tenant_key = tenant_key
    user.last_login_at = datetime.now(timezone.utc)
    user.updated_at = datetime.now(timezone.utc)
    await db.commit()
    session_token = await create_session(db, user, request)
    response = RedirectResponse(return_to, status_code=302)
    set_session_cookie(response, session_token)
    return response


@router.get("/me")
async def me(user: AdminUser = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await _user_payload(user, db)


@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    await revoke_session(db, request.cookies.get(settings.AUTH_SESSION_COOKIE))
    clear_session_cookie(response)
