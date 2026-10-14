"""Resource-scoped grants; global account permissions are never a union of roles.

All lookups use the current transaction instead of a process/session cache, so
membership and role changes take effect on the next authenticated request.
"""
import uuid

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AdminUser, GuestWorkshopAccess, WorkshopMember, Workshop
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


async def guest_workshop_ids(db: AsyncSession, user: AdminUser) -> set[uuid.UUID] | None:
    """Workshop của tài khoản khách check-in; None nghĩa là mọi workshop."""
    if getattr(user, "access_all_workshops", False):
        return None
    return set((await db.execute(
        select(GuestWorkshopAccess.workshop_id).where(GuestWorkshopAccess.user_id == user.id)
    )).scalars().all())


async def guest_has_workshop(db: AsyncSession, user: AdminUser) -> bool:
    """Khách chỉ đăng nhập được khi phạm vi của họ còn ít nhất một workshop tồn tại."""
    scope = await guest_workshop_ids(db, user)
    query = select(Workshop.id)
    if scope is not None:
        if not scope:
            return False
        query = query.where(Workshop.id.in_(scope))
    return await db.scalar(query.limit(1)) is not None


async def guest_scope_payload(db: AsyncSession, user: AdminUser) -> dict:
    if not is_checkin_guest(user):
        return {"access_all_workshops": False, "access_workshop_ids": [], "access_workshop_id": None}
    scope = await guest_workshop_ids(db, user)
    ids = sorted(str(workshop_id) for workshop_id in scope or ())
    # access_workshop_id giữ lại cho client cũ: workshop đầu tiên trong phạm vi.
    return {"access_all_workshops": scope is None, "access_workshop_ids": ids, "access_workshop_id": ids[0] if ids else None}


async def set_guest_workshops(db: AsyncSession, user: AdminUser, workshop_ids: list[uuid.UUID], all_workshops: bool) -> None:
    await db.execute(delete(GuestWorkshopAccess).where(GuestWorkshopAccess.user_id == user.id))
    user.access_all_workshops = all_workshops
    # Cột cũ được để trống để migration chạy lại không khôi phục workshop đã gỡ.
    user.access_workshop_id = None
    if not all_workshops:
        for workshop_id in dict.fromkeys(workshop_ids):
            db.add(GuestWorkshopAccess(user_id=user.id, workshop_id=workshop_id))


async def workshop_permissions(db: AsyncSession, user: AdminUser, workshop_id: uuid.UUID) -> set[str]:
    if user.is_active is False:
        return set()
    if is_checkin_guest(user):
        if not guest_access_active(user) or await db.get(Workshop, workshop_id) is None:
            return set()
        scope = await guest_workshop_ids(db, user)
        return set(CHECKIN_GUEST_PERMISSIONS) if scope is None or workshop_id in scope else set()
    if is_global_workshop_admin(user):
        return await _role_grants(db, user, user.role)
    role = (await db.execute(
        select(WorkshopMember.role).where(
            WorkshopMember.user_id == user.id,
            WorkshopMember.workshop_id == workshop_id,
        )
    )).scalar_one_or_none()
    granted = await _role_grants(db, user, role) if role is not None else set()
    if user.all_workshops_role and await db.get(Workshop, workshop_id) is not None:
        granted |= await _role_grants(db, user, user.all_workshops_role)
    return granted


async def has_workshop_role(db: AsyncSession, user: AdminUser, workshop_id: uuid.UUID, role: str) -> bool:
    """Whether the user holds a workshop role there, directly or via all_workshops_role."""
    if is_checkin_guest(user) or user.is_active is False:
        return False
    if user.all_workshops_role == role:
        return True
    member = await db.get(WorkshopMember, (user.id, workshop_id))
    return member is not None and member.role == role


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
        if not guest_access_active(user):
            return []
        scope = await guest_workshop_ids(db, user)
        query = select(Workshop.id).order_by(Workshop.id)
        if scope is not None:
            query = query.where(Workshop.id.in_(scope))
        workshop_ids = (await db.execute(query)).scalars().all()
        permissions = sorted(CHECKIN_GUEST_PERMISSIONS)
        return [{"workshop_id": str(workshop_id), "role": "checkin_guest", "permissions": permissions} for workshop_id in workshop_ids]
    members = (await db.execute(
        select(WorkshopMember).where(WorkshopMember.user_id == user.id)
        .order_by(WorkshopMember.workshop_id)
    )).scalars().all()
    grants_by_role: dict[str, set[str]] = {}

    async def grants(role: str) -> set[str]:
        if role not in grants_by_role:
            grants_by_role[role] = await _role_grants(db, user, role)
        return grants_by_role[role]

    roles = {member.workshop_id: member.role for member in members}
    if user.all_workshops_role:
        workshop_ids = (await db.execute(select(Workshop.id).order_by(Workshop.id))).scalars().all()
    else:
        workshop_ids = list(roles)
    result = []
    for workshop_id in workshop_ids:
        role = roles.get(workshop_id)
        granted = set(await grants(role)) if role else set()
        if user.all_workshops_role:
            granted |= await grants(user.all_workshops_role)
        result.append({
            "workshop_id": str(workshop_id),
            "role": role or user.all_workshops_role,
            "permissions": sorted(granted),
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
