"""Resource-scoped grants; global account permissions are never a union of roles.

All lookups use the current transaction instead of a process/session cache, so
membership and role changes take effect on the next authenticated request.
"""
import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AdminUser, WorkshopMember, Workshop
from .local_accounts import CHECKIN_GUEST_PERMISSIONS, guest_access_active, is_checkin_guest
from .permissions import PERMISSIONS, effective_permissions_for_user


GLOBAL_WORKSHOP_ROLES = frozenset({"admin", "super_admin"})
WORKSHOP_PERMISSIONS = frozenset(
    permission for permission in PERMISSIONS
    if permission.startswith((
        "workshops.", "guests.", "checkin.", "registration_forms.",
        "reports.", "zbs.", "zalo_messages.",
    )) or permission == "uploads.create"
)


def is_global_workshop_admin(user: AdminUser) -> bool:
    # Only the account role bypasses membership. A workshop's admin role does not.
    return not is_checkin_guest(user) and user.role in GLOBAL_WORKSHOP_ROLES


async def _role_grants(db: AsyncSession, user: AdminUser, role: str) -> set[str]:
    return (await effective_permissions_for_user(db, role, user.permission_overrides)) & WORKSHOP_PERMISSIONS


async def workshop_permissions(db: AsyncSession, user: AdminUser, workshop_id: uuid.UUID) -> set[str]:
    if user.is_active is False:
        return set()
    if is_checkin_guest(user):
        if guest_access_active(user) and user.access_workshop_id == workshop_id and await db.get(Workshop, workshop_id) is not None:
            return set(CHECKIN_GUEST_PERMISSIONS)
        return set()
    if is_global_workshop_admin(user):
        return await _role_grants(db, user, user.role)
    role = (await db.execute(
        select(WorkshopMember.role).where(
            WorkshopMember.user_id == user.id,
            WorkshopMember.workshop_id == workshop_id,
        )
    )).scalar_one_or_none()
    if role is None:
        return set()
    return await _role_grants(db, user, role)


def _has_grants(granted: set[str], permissions: tuple[str, ...], any_of: bool) -> bool:
    if not permissions:
        return bool(granted)
    return any(p in granted for p in permissions) if any_of else all(p in granted for p in permissions)


async def require_workshop_permission(
    db: AsyncSession, user: AdminUser, workshop_id: uuid.UUID,
    *permissions: str, any_of: bool = False,
) -> None:
    granted = await workshop_permissions(db, user, workshop_id)
    if not _has_grants(granted, permissions, any_of):
        raise HTTPException(403, "Bạn không có quyền thực hiện thao tác này trong workshop.")


async def workshop_access_payload(db: AsyncSession, user: AdminUser) -> list[dict]:
    if user.is_active is False or is_global_workshop_admin(user):
        return []
    if is_checkin_guest(user):
        granted = await workshop_permissions(db, user, user.access_workshop_id)
        return [{"workshop_id": str(user.access_workshop_id), "role": "checkin_guest", "permissions": sorted(granted)}] if granted else []
    members = (await db.execute(
        select(WorkshopMember).where(WorkshopMember.user_id == user.id)
        .order_by(WorkshopMember.workshop_id)
    )).scalars().all()
    grants_by_role: dict[str, set[str]] = {}
    result = []
    for member in members:
        if member.role not in grants_by_role:
            grants_by_role[member.role] = await _role_grants(db, user, member.role)
        result.append({
            "workshop_id": str(member.workshop_id),
            "role": member.role,
            "permissions": sorted(grants_by_role[member.role]),
        })
    return result


async def allowed_workshop_ids(
    db: AsyncSession, user: AdminUser, *permissions: str, any_of: bool = False,
) -> set[uuid.UUID] | None:
    """None means unrestricted IDs, never unrestricted functional permissions."""
    if user.is_active is False:
        return set()
    if is_global_workshop_admin(user):
        granted = await _role_grants(db, user, user.role)
        return None if _has_grants(granted, permissions, any_of) else set()
    access = await workshop_access_payload(db, user)
    return {
        uuid.UUID(entry["workshop_id"]) for entry in access
        if _has_grants(set(entry["permissions"]), permissions, any_of)
    }
