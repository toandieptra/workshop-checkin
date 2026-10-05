import uuid
from fastapi import APIRouter, Depends
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.workshop_access import WORKSHOP_PERMISSIONS, allowed_workshop_ids, is_global_workshop_admin, require_workshop_permission
from ..db import get_db
from ..models import Guest
from ..schemas import GuestOut
from ..auth.dependencies import current_user, require_permission

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("/guests", response_model=list[GuestOut])
async def search_guests(
    q: str,
    workshop_id: uuid.UUID | None = None,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    user=Depends(current_user),
):
    if workshop_id:
        await require_workshop_permission(db, user, workshop_id, "guests.read")
    accessible = await allowed_workshop_ids(db, user, "guests.read")
    pattern = f"%{q}%"
    stmt = (
        select(Guest).where(
            or_(
                Guest.full_name.ilike(pattern),
                Guest.phone.ilike(pattern),
                Guest.company.ilike(pattern),
            )
        )
    )
    if accessible is not None:
        stmt = stmt.where(Guest.workshop_id.in_(accessible))
    if workshop_id:
        stmt = stmt.where(Guest.workshop_id == workshop_id)
    stmt = stmt.where(Guest.deleted_at.is_(None)).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return rows
