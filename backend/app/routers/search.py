import uuid
from fastapi import APIRouter, Depends
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models import Guest
from ..schemas import GuestOut

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("/guests", response_model=list[GuestOut])
async def search_guests(
    q: str,
    workshop_id: uuid.UUID | None = None,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
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
    if workshop_id:
        stmt = stmt.where(Guest.workshop_id == workshop_id)
    stmt = stmt.where(Guest.deleted_at.is_(None)).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return rows
