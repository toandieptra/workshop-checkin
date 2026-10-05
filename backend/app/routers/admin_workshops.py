import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import current_user, require_permission
from ..auth.local_accounts import is_checkin_guest
from ..auth.workshop_access import GLOBAL_WORKSHOP_ROLES, is_global_workshop_admin, require_workshop_permission
from ..db import get_db
from ..models import AdminUser, RolePermission, WelcomeEvent, Workshop, WorkshopMember


router = APIRouter(prefix="/api/admin/workshops", tags=["admin-workshop-access"])


class MemberAssignment(BaseModel):
    user_id: uuid.UUID
    role: str


class MembersUpdate(BaseModel):
    members: list[MemberAssignment]


async def _members_payload(db: AsyncSession, workshop_id: uuid.UUID) -> dict:
    inherited = set((await db.execute(
        select(AdminUser.id).where(AdminUser.role.in_(GLOBAL_WORKSHOP_ROLES), AdminUser.account_type != "checkin_guest")
    )).scalars().all())
    members = (await db.execute(
        select(WorkshopMember).join(AdminUser, AdminUser.id == WorkshopMember.user_id).where(WorkshopMember.workshop_id == workshop_id, AdminUser.account_type != "checkin_guest")
        .order_by(WorkshopMember.user_id)
    )).scalars().all()
    return {
        "members": [{"user_id": str(m.user_id), "role": m.role} for m in members if m.user_id not in inherited],
        "inherited_user_ids": sorted(str(user_id) for user_id in inherited),
    }


@router.get("")
async def list_managed_workshops(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_permission("users.manage")),
):
    workshops = (await db.execute(
        select(Workshop).order_by(Workshop.event_date.desc().nulls_last(), Workshop.created_at.desc())
    )).scalars().all()
    return [{
        "id": str(w.id), "name": w.name, "slug": w.slug,
        "status": w.status, "event_date": w.event_date,
    } for w in workshops]


@router.get("/{workshop_id}/members")
async def get_members(
    workshop_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_permission("users.manage")),
):
    if await db.get(Workshop, workshop_id) is None:
        raise HTTPException(404, "Không tìm thấy workshop.")
    return await _members_payload(db, workshop_id)


@router.put("/{workshop_id}/members")
async def replace_members(
    workshop_id: uuid.UUID,
    body: MembersUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_permission("users.manage")),
):
    # Serialize replacements of the same workshop to prevent interleaved saves.
    workshop = (await db.execute(
        select(Workshop).where(Workshop.id == workshop_id).with_for_update()
    )).scalar_one_or_none()
    if workshop is None:
        raise HTTPException(404, "Không tìm thấy workshop.")
    ids = [member.user_id for member in body.members]
    if len(set(ids)) != len(ids):
        raise HTTPException(400, "Mỗi người dùng chỉ được gán một vai trò trong workshop.")
    if any(member.role == "super_admin" for member in body.members):
        raise HTTPException(400, "Không thể gán Quản trị cấp cao trong một workshop.")
    users = (await db.execute(select(AdminUser).where(AdminUser.id.in_(ids)))).scalars().all() if ids else []
    if {user.id for user in users} != set(ids):
        raise HTTPException(400, "Danh sách có người dùng không tồn tại.")
    if any(is_checkin_guest(user) for user in users):
        raise HTTPException(400, "Tài khoản khách được cấp workshop và thời gian tại trang Người dùng.")
    if any(is_global_workshop_admin(user) for user in users):
        raise HTTPException(400, "Tài khoản quản trị đã có quyền truy cập mọi workshop.")
    roles = set((await db.execute(
        select(RolePermission.role).where(RolePermission.role.in_({m.role for m in body.members}))
    )).scalars().all()) if body.members else set()
    if {member.role for member in body.members} - roles:
        raise HTTPException(400, "Vai trò không hợp lệ.")

    # Keep dormant assignments for accounts promoted to global administrators.
    inherited_users = select(AdminUser.id).where(AdminUser.role.in_(GLOBAL_WORKSHOP_ROLES), AdminUser.account_type != "checkin_guest")
    await db.execute(delete(WorkshopMember).where(
        WorkshopMember.workshop_id == workshop_id,
        WorkshopMember.user_id.not_in(inherited_users),
    ))
    for member in body.members:
        db.add(WorkshopMember(user_id=member.user_id, workshop_id=workshop_id, role=member.role))
    await db.commit()
    return await _members_payload(db, workshop_id)


@router.get("/{workshop_id}/welcome/latest")
async def latest_admin_welcome(
    workshop_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: AdminUser = Depends(current_user),
):
    await require_workshop_permission(db, user, workshop_id, "guests.read")
    row = (await db.execute(
        select(WelcomeEvent).where(WelcomeEvent.workshop_id == workshop_id)
        .order_by(WelcomeEvent.created_at.desc(), WelcomeEvent.id.desc()).limit(1)
    )).scalar_one_or_none()
    if row is None:
        return None
    return {
        "id": str(row.id), "workshop_id": str(row.workshop_id),
        "guest_id": str(row.guest_id) if row.guest_id else None,
        "display_name": row.display_name, "display_message": row.display_message,
        "created_at": row.created_at,
    }
