import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator
from typing import Literal
from starlette.concurrency import run_in_threadpool
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import require_permission
from ..auth.permissions import PERMISSIONS, ROLE_PERMISSIONS, effective_permissions_for_user, role_exists, role_permissions
from ..auth.session import clear_session_cookie, token_hash
from ..config import settings
from ..db import get_db
from ..models import AdminSession, AdminUser, RolePermission, Workshop
from ..auth.local_accounts import account_access_payload, account_type, guest_access_active, hash_password, is_checkin_guest, utc_datetime, normalize_username
from ..services.admin_directory_sync import get_sync_state, status_payload, sync_directory

router = APIRouter(prefix="/api/admin/users", tags=["admin-users"])
BUILT_IN_ROLES = set(ROLE_PERMISSIONS)


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str | None = Field(default=None, min_length=3, max_length=64)
    role: str | None = None
    name: str | None = Field(default=None, max_length=200)
    is_active: bool | None = None
    permission_overrides: dict[str, bool] | None = None
    access_workshop_id: uuid.UUID | None = None
    access_starts_at: AwareDatetime | None = None
    access_expires_at: AwareDatetime | None = None


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    email: str | None = Field(default=None, min_length=3, max_length=254)
    username: str | None = Field(default=None, min_length=3, max_length=64)
    password: str = Field(min_length=12, max_length=128)
    account_type: Literal["local", "checkin_guest"]
    role: str = "user"
    is_active: bool = True
    access_workshop_id: uuid.UUID | None = None
    access_starts_at: AwareDatetime | None = None
    access_expires_at: AwareDatetime | None = None

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        email = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise ValueError("Email không hợp lệ.")
        return email

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str | None) -> str | None:
        return normalize_username(value) if value is not None else None

    @model_validator(mode="after")
    def validate_identity(self):
        if self.account_type == "checkin_guest":
            if not self.username:
                raise ValueError("Tài khoản khách cần username được cấp.")
            if self.email is not None:
                raise ValueError("Tài khoản khách dùng username, không dùng email đăng nhập.")
        elif not self.email or self.username is not None:
            raise ValueError("Tài khoản riêng cần email đăng nhập, không dùng username.")
        return self

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        name = " ".join(value.split())
        if not name:
            raise ValueError("Vui lòng nhập tên tài khoản.")
        return name


class PasswordReset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(min_length=12, max_length=128)


class RolePermissionsUpdate(BaseModel):
    permissions: list[str]


class RoleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=200)


async def _validate(db: AsyncSession, role: str, overrides: dict[str, bool]) -> None:
    if not await role_exists(db, role):
        raise HTTPException(400, f"invalid role: {role}")
    unknown = set(overrides) - PERMISSIONS
    if unknown:
        raise HTTPException(400, f"unknown permissions: {', '.join(sorted(unknown))}")


async def _out(user: AdminUser, db: AsyncSession) -> dict:
    return {
        "id": str(user.id), "email": user.email, "name": user.name,
        "avatar_url": user.avatar_url, "role": "user" if is_checkin_guest(user) else user.role, "is_active": user.is_active,
        "enterprise_email": user.enterprise_email,
        "permission_overrides": {} if is_checkin_guest(user) else user.permission_overrides or {},
        **account_access_payload(user),
        "permissions": [] if is_checkin_guest(user) else sorted(await effective_permissions_for_user(db, user.role, user.permission_overrides)),
        "lark_tenant_key": user.lark_tenant_key, "lark_user_id": user.lark_user_id,
        "lark_account_status": user.lark_account_status,
        "lark_is_activated": user.lark_is_activated, "lark_is_frozen": user.lark_is_frozen,
        "lark_is_resigned": user.lark_is_resigned, "lark_last_synced_at": user.lark_last_synced_at,
        "last_login_at": user.last_login_at,
        "created_at": user.created_at, "updated_at": user.updated_at,
    }


async def _validate_guest_access(db: AsyncSession, workshop_id, starts_at, expires_at, *, require_future: bool = True) -> None:
    if not workshop_id or not starts_at or not expires_at:
        raise HTTPException(400, "Tài khoản khách cần một workshop và thời gian bắt đầu, kết thúc.")
    if utc_datetime(starts_at) >= utc_datetime(expires_at):
        raise HTTPException(400, "Thời gian kết thúc phải sau thời gian bắt đầu.")
    if require_future and utc_datetime(expires_at) <= datetime.now(timezone.utc):
        raise HTTPException(400, "Thời gian kết thúc phải ở tương lai.")
    if await db.get(Workshop, workshop_id) is None:
        raise HTTPException(400, "Workshop không tồn tại.")


@router.post("", status_code=201)
async def create_user(body: UserCreate, db: AsyncSession = Depends(get_db),
                      _=Depends(require_permission("users.manage"))):
    if body.username and (await db.execute(select(AdminUser.id).where(func.lower(AdminUser.username) == body.username))).scalar_one_or_none():
        raise HTTPException(409, "Username này đã được sử dụng.")
    if body.email and (await db.execute(select(AdminUser.id).where(func.lower(AdminUser.email) == body.email))).scalar_one_or_none():
        raise HTTPException(409, "Email này đã được sử dụng.")
    if body.account_type == "checkin_guest":
        await _validate_guest_access(db, body.access_workshop_id, body.access_starts_at, body.access_expires_at)
        role = "user"
    else:
        if any(value is not None for value in (body.access_workshop_id, body.access_starts_at, body.access_expires_at)):
            raise HTTPException(400, "Chỉ tài khoản khách mới có thời gian truy cập giới hạn.")
        role = body.role
        await _validate(db, role, {})
    user = AdminUser(email=body.email, username=body.username, name=body.name, account_type=body.account_type,
                     role=role, is_active=True if role == "super_admin" else body.is_active,
                     permission_overrides={}, password_hash=await run_in_threadpool(hash_password, body.password),
                     access_workshop_id=body.access_workshop_id, access_starts_at=body.access_starts_at,
                     access_expires_at=body.access_expires_at)
    db.add(user)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "Không thể tạo tài khoản. Email có thể đã được sử dụng.") from exc
    await db.refresh(user)
    return await _out(user, db)


@router.put("/{user_id}/password", status_code=204)
async def reset_password(user_id: uuid.UUID, body: PasswordReset, request: Request, response: Response,
                         db: AsyncSession = Depends(get_db), _=Depends(require_permission("users.manage"))):
    user = await db.get(AdminUser, user_id)
    if user is None:
        raise HTTPException(404, "user not found")
    if account_type(user) not in {"local", "checkin_guest"}:
        raise HTTPException(400, "Tài khoản Lark sử dụng mật khẩu do Lark quản lý.")
    user.password_hash = await run_in_threadpool(hash_password, body.password)
    user.updated_at = datetime.now(timezone.utc)
    current_token = request.cookies.get(settings.AUTH_SESSION_COOKIE)
    own_session = None
    if current_token:
        own_session = (await db.execute(select(AdminSession.id).where(
            AdminSession.user_id == user_id, AdminSession.token_hash == token_hash(current_token)
        ))).scalar_one_or_none()
    await db.execute(delete(AdminSession).where(AdminSession.user_id == user_id))
    await db.commit()
    if own_session:
        clear_session_cookie(response)


@router.get("")
async def list_users(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_permission("users.manage")),
):
    users = (await db.execute(select(AdminUser).order_by(AdminUser.created_at))).scalars().all()
    return [await _out(user, db) for user in users]


def _session_payload(
    session: AdminSession,
    *,
    current_token_hash: str | None,
    now: datetime,
    account_active: bool = True,
) -> dict:
    """Serialize a login session without ever exposing its token hash.

    Session rows are deleted when explicitly revoked or when an expired token
    is presented, so ``is_active`` is derived from the expiry timestamp and
    account active state. The status field is included alongside the boolean
    to keep the API convenient for clients that need a display label.
    """
    expires_at = session.expires_at
    # PostgreSQL returns timezone-aware values. Normalize a naive value as UTC
    # as a defensive measure for tests and older database drivers.
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    active = account_active and expires_at > now
    return {
        "id": str(session.id),
        "user_id": str(session.user_id),
        "user_agent": session.user_agent,
        "ip_address": session.ip_address,
        "created_at": session.created_at,
        "last_seen_at": session.last_seen_at,
        "expires_at": session.expires_at,
        "is_current": bool(current_token_hash and session.token_hash == current_token_hash),
        "is_active": active,
        "status": "active" if active else "expired",
    }


@router.get("/{user_id}/sessions")
async def list_user_sessions(
    user_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_permission("users.manage")),
):
    """List login sessions for one managed account, newest devices first."""
    user = await db.get(AdminUser, user_id)
    if user is None:
        raise HTTPException(404, "user not found")
    sessions = (await db.execute(
        select(AdminSession)
        .where(AdminSession.user_id == user_id)
        .order_by(AdminSession.created_at.desc(), AdminSession.last_seen_at.desc())
    )).scalars().all()
    current_token = request.cookies.get(settings.AUTH_SESSION_COOKIE)
    current_token_hash = token_hash(current_token) if current_token else None
    now = datetime.now(timezone.utc)
    return [
        _session_payload(
            session,
            current_token_hash=current_token_hash,
            now=now,
            account_active=user.is_active and (not is_checkin_guest(user) or guest_access_active(user, now)),
        )
        for session in sessions
    ]


@router.delete("/{user_id}/sessions/{session_id}", status_code=204)
async def revoke_user_session(
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_permission("users.manage")),
):
    """Sign out a device session belonging to the selected account.

    The user id is part of the lookup deliberately, preventing an admin from
    revoking a session copied from a different account. Revoking the current
    browser session also clears its cookie immediately.
    """
    if await db.get(AdminUser, user_id) is None:
        raise HTTPException(404, "user not found")
    session = (await db.execute(
        select(AdminSession).where(
            AdminSession.id == session_id,
            AdminSession.user_id == user_id,
        )
    )).scalar_one_or_none()
    if session is None:
        raise HTTPException(404, "session not found")
    current_token = request.cookies.get(settings.AUTH_SESSION_COOKIE)
    is_current = bool(current_token and session.token_hash == token_hash(current_token))
    await db.delete(session)
    await db.commit()
    if is_current:
        clear_session_cookie(response)


@router.get("/catalog")
async def permission_catalog(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_permission("users.manage")),
):
    return {
        "permissions": sorted(PERMISSIONS),
        "roles": [
            {
                "key": record.role,
                "label": record.label,
                "description": record.description or "",
                "permissions": sorted(set(record.permissions) & set(PERMISSIONS)),
                "built_in": record.role in BUILT_IN_ROLES,
            }
            for record in (await db.execute(select(RolePermission).order_by(RolePermission.role))).scalars().all()
        ],
    }


@router.post("/roles", status_code=201)
async def create_role(
    body: RoleCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_permission("users.manage")),
):
    label = " ".join(body.name.split())
    if not label:
        raise HTTPException(400, "role name is required")
    key = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")
    if not key:
        raise HTTPException(400, "role name must contain letters or numbers")
    if key in BUILT_IN_ROLES:
        raise HTTPException(409, "a built-in role already uses this name")
    if await db.get(RolePermission, key):
        raise HTTPException(409, "a role with this name already exists")

    role = RolePermission(
        role=key,
        label=label,
        description=(body.description or "").strip() or None,
        permissions=[],
    )
    db.add(role)
    await db.commit()
    return {"key": role.role, "label": role.label, "description": role.description or "", "permissions": [], "built_in": False}


@router.put("/roles/{role}")
async def update_role_permissions(
    role: str,
    body: RolePermissionsUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_permission("users.manage")),
):
    if not await role_exists(db, role):
        raise HTTPException(404, "role not found")
    if role == "user":
        raise HTTPException(400, "the default user role cannot be edited")
    requested = set(body.permissions)
    unknown = requested - set(PERMISSIONS)
    if unknown:
        raise HTTPException(400, f"unknown permissions: {', '.join(sorted(unknown))}")
    if role == "super_admin" and "users.manage" not in requested:
        raise HTTPException(400, "super_admin must keep users.manage")

    record = await db.get(RolePermission, role)
    if record is None:
        # Kept for database instances that predate migration 017's role seeds.
        record = RolePermission(role=role, label=role, permissions=sorted(requested))
        db.add(record)
    else:
        record.permissions = sorted(requested)
        record.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"role": role, "permissions": sorted(requested)}


@router.get("/directory-sync/status")
async def directory_sync_status(db: AsyncSession = Depends(get_db), _=Depends(require_permission("users.manage"))):
    return status_payload(await get_sync_state(db))


@router.post("/directory-sync")
async def run_directory_sync(db: AsyncSession = Depends(get_db), _=Depends(require_permission("users.manage"))):
    try:
        result = await sync_directory(db)
    except Exception as exc:
        raise HTTPException(502, f"Lark directory sync failed: {exc}")
    return {**result.__dict__, **status_payload(await get_sync_state(db))}


@router.patch("/{user_id}")
async def update_user(user_id: uuid.UUID, body: UserUpdate, db: AsyncSession = Depends(get_db), _=Depends(require_permission("users.manage"))):
    user = await db.get(AdminUser, user_id)
    if not user:
        raise HTTPException(404, "user not found")
    changes = body.model_dump(exclude_unset=True)
    if any(changes.get(key, True) is None for key in ("role", "is_active", "permission_overrides")):
        raise HTTPException(400, "Vai trò, trạng thái và quyền không được để trống.")
    if "name" in changes and changes["name"] is not None:
        changes["name"] = " ".join(changes["name"].split())
        if not changes["name"]:
            raise HTTPException(400, "Vui lòng nhập tên tài khoản.")
    username_changed = False
    if "username" in changes:
        if not is_checkin_guest(user):
            raise HTTPException(400, "Chỉ tài khoản khách sử dụng username.")
        if changes["username"] is None:
            raise HTTPException(400, "Username không được để trống.")
        try:
            changes["username"] = normalize_username(changes["username"])
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        username_changed = changes["username"] != user.username
        if username_changed and (await db.execute(select(AdminUser.id).where(func.lower(AdminUser.username) == changes["username"], AdminUser.id != user.id))).scalar_one_or_none():
            raise HTTPException(409, "Username này đã được sử dụng.")
    access_keys = {"access_workshop_id", "access_starts_at", "access_expires_at"}
    access_changed = any(key in changes and changes[key] != getattr(user, key) for key in access_keys)
    if is_checkin_guest(user):
        if changes.get("role", "user") != "user" or changes.get("permission_overrides", {}) != {}:
            raise HTTPException(400, "Tài khoản khách chỉ có quyền check-in cố định.")
        if access_keys & changes.keys():
            await _validate_guest_access(db, changes.get("access_workshop_id", user.access_workshop_id),
                                         changes.get("access_starts_at", user.access_starts_at),
                                         changes.get("access_expires_at", user.access_expires_at))
        changes["role"], changes["permission_overrides"] = "user", {}
    else:
        if access_keys & changes.keys():
            raise HTTPException(400, "Chỉ tài khoản khách mới có thời gian truy cập giới hạn.")
        role = changes.get("role", user.role)
        overrides = changes.get("permission_overrides", user.permission_overrides or {})
        await _validate(db, role, overrides)
        if user.role == "super_admin" and changes.get("is_active") is False:
            raise HTTPException(400, "super_admin account cannot be deactivated")
        if role == "super_admin":
            changes["is_active"] = True
    for key, value in changes.items():
        setattr(user, key, value)
    user.updated_at = datetime.now(timezone.utc)
    if changes.get("is_active") is False or access_changed or username_changed:
        await db.execute(delete(AdminSession).where(AdminSession.user_id == user.id))
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409 if username_changed else 400, "Username đã được sử dụng." if username_changed else "Không thể cập nhật tài khoản với dữ liệu này.") from exc
    await db.refresh(user)
    return await _out(user, db)
