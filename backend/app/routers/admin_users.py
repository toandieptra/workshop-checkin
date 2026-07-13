import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import require_permission
from ..auth.permissions import PERMISSIONS, ROLE_PERMISSIONS, effective_permissions_for_user, role_exists, role_permissions
from ..db import get_db
from ..models import AdminSession, AdminUser, RolePermission
from ..services.admin_directory_sync import get_sync_state, status_payload, sync_directory

router = APIRouter(prefix="/api/admin/users", tags=["admin-users"])
BUILT_IN_ROLES = set(ROLE_PERMISSIONS)


class UserCreate(BaseModel):
    email: str
    role: str = "viewer"
    name: str | None = None
    is_active: bool = True
    permission_overrides: dict[str, bool] = Field(default_factory=dict)


class UserUpdate(BaseModel):
    role: str | None = None
    name: str | None = None
    is_active: bool | None = None
    permission_overrides: dict[str, bool] | None = None


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
        "avatar_url": user.avatar_url, "role": user.role, "is_active": user.is_active,
        "enterprise_email": user.enterprise_email,
        "permission_overrides": user.permission_overrides or {},
        "permissions": sorted(await effective_permissions_for_user(db, user.role, user.permission_overrides)),
        "lark_tenant_key": user.lark_tenant_key, "lark_user_id": user.lark_user_id,
        "lark_account_status": user.lark_account_status,
        "lark_is_activated": user.lark_is_activated, "lark_is_frozen": user.lark_is_frozen,
        "lark_is_resigned": user.lark_is_resigned, "lark_last_synced_at": user.lark_last_synced_at,
        "last_login_at": user.last_login_at,
        "created_at": user.created_at, "updated_at": user.updated_at,
    }


@router.get("")
async def list_users(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_permission("users.manage")),
):
    users = (await db.execute(select(AdminUser).order_by(AdminUser.created_at))).scalars().all()
    return [await _out(user, db) for user in users]


@router.post("", status_code=201)
async def create_user(body: UserCreate, db: AsyncSession = Depends(get_db), _=Depends(require_permission("users.manage"))):
    email = body.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(400, "invalid email")
    await _validate(db, body.role, body.permission_overrides)
    if body.role == "super_admin" and not body.is_active:
        raise HTTPException(400, "super_admin account must always be active")
    if (await db.execute(select(AdminUser.id).where(func.lower(AdminUser.email) == email))).scalar_one_or_none():
        raise HTTPException(409, "email already exists")
    user = AdminUser(email=email, name=body.name, role=body.role, is_active=body.is_active,
                     permission_overrides=body.permission_overrides)
    db.add(user)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(400, f"could not create user: {exc.orig}") from exc
    await db.refresh(user)
    return await _out(user, db)


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
    role = changes.get("role", user.role)
    overrides = changes.get("permission_overrides", user.permission_overrides or {})
    await _validate(db, role, overrides)
    if user.role == "super_admin" and changes.get("is_active") is False:
        raise HTTPException(400, "super_admin account cannot be deactivated")
    if role == "super_admin":
        # Super admins are an emergency/ownership role and must never become
        # inaccessible, including when promoting an inactive account.
        changes["is_active"] = True
    for key, value in changes.items():
        setattr(user, key, value)
    user.updated_at = datetime.now(timezone.utc)
    if changes.get("is_active") is False:
        await db.execute(delete(AdminSession).where(AdminSession.user_id == user.id))
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(400, f"could not update user: {exc.orig}") from exc
    await db.refresh(user)
    return await _out(user, db)
