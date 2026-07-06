import logging
import re
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, text, func, nulls_last
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models import Workshop, Guest
from ..schemas import WorkshopCreate, WorkshopOut, GuestCreate, GuestOut

logger = logging.getLogger("workshops")
router = APIRouter(prefix="/api", tags=["workshops"])


def _search_tokens(search: str | None) -> list[str]:
    if not search:
        return []
    return [t.lower() for t in re.findall(r"[\w\d]+", search.strip(), flags=re.UNICODE) if t.strip()]


async def _search_guest_ids(db: AsyncSession, workshop_id: uuid.UUID, search: str, limit: int = 5000) -> list[uuid.UUID]:
    tokens = _search_tokens(search)
    if not tokens:
        return []

    params: dict[str, object] = {"workshop_id": str(workshop_id), "limit": limit}
    parts: list[str] = []
    for i, token in enumerate(tokens):
        params[f"tok_{i}"] = token
        params[f"phone_{i}"] = f"%{''.join(c for c in token if c.isdigit()) or token}%"
        parts.append(f"""
        (
          unaccent(lower(coalesce(full_name, ''))) ~ ('(^|[^[:alnum:]])' || unaccent(lower(:tok_{i})))
          OR unaccent(lower(coalesce(business_model, ''))) LIKE ('%' || unaccent(lower(:tok_{i})) || '%')
          OR unaccent(lower(coalesce(role_title, ''))) LIKE ('%' || unaccent(lower(:tok_{i})) || '%')
          OR unaccent(lower(coalesce(guest_type, ''))) LIKE ('%' || unaccent(lower(:tok_{i})) || '%')
          OR regexp_replace(coalesce(phone, ''), '\\D', '', 'g') LIKE :phone_{i}
        )
        """)

    sql = text(f"""
        SELECT id
        FROM guests
        WHERE workshop_id = :workshop_id
          AND {' AND '.join(parts)}
        LIMIT :limit
    """)
    rows = (await db.execute(sql, params)).scalars().all()
    return rows


@router.get("/workshops", response_model=list[WorkshopOut])
async def list_workshops(db: AsyncSession = Depends(get_db)):
    # Sắp xếp: event_date DESC (gần → xa), NULL xuống cuối; tie-breaker created_at DESC.
    rows = (await db.execute(
        select(Workshop).order_by(
            nulls_last(Workshop.event_date.desc()),
            Workshop.created_at.desc(),
        )
    )).scalars().all()
    return rows


@router.post("/workshops", response_model=WorkshopOut, status_code=201)
async def create_workshop(body: WorkshopCreate, db: AsyncSession = Depends(get_db)):
    exists = (await db.execute(select(Workshop).where(Workshop.slug == body.slug))).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "slug already exists")
    w = Workshop(**body.model_dump())
    db.add(w)
    await db.commit()
    await db.refresh(w)
    return w


@router.get("/workshops/{workshop_id}", response_model=WorkshopOut)
async def get_workshop(workshop_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    w = await db.get(Workshop, workshop_id)
    if not w:
        raise HTTPException(404, "not found")
    return w


@router.get("/workshops/{workshop_id}/guests", response_model=list[GuestOut])
async def list_guests(
    workshop_id: uuid.UUID,
    search: str | None = None,
    sort_registered_at: str = Query("desc", pattern="^(asc|desc)$"),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy.orm import selectinload
    order_col = func.coalesce(Guest.registered_at, Guest.created_at)
    stmt = (
        select(Guest)
        .where(Guest.workshop_id == workshop_id, Guest.deleted_at.is_(None))
    )
    if search and search.strip():
        ids = await _search_guest_ids(db, workshop_id, search)
        if not ids:
            return []
        stmt = stmt.where(Guest.id.in_(ids))
    if sort_registered_at == "asc":
        stmt = stmt.order_by(order_col.asc(), Guest.full_name)
    else:
        stmt = stmt.order_by(order_col.desc(), Guest.full_name)
    rows = (await db.execute(stmt)).scalars().all()
    return rows


@router.post("/workshops/{workshop_id}/guests", response_model=GuestOut, status_code=201)
async def create_guest(workshop_id: uuid.UUID, body: GuestCreate, db: AsyncSession = Depends(get_db)):
    w = await db.get(Workshop, workshop_id)
    if not w:
        raise HTTPException(404, "workshop not found")
    g = Guest(workshop_id=workshop_id, registered_at=datetime.now(timezone.utc), **body.model_dump())
    db.add(g)
    await db.commit()
    await db.refresh(g)
    try:
        from .lark_sync import _push_guest_to_lark
        await _push_guest_to_lark(db, g)
    except Exception as e:
        logger.warning("auto push guest to lark failed for %s: %s", g.id, e)
    g = await db.get(Guest, g.id)
    return g
