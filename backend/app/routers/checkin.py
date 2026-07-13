from uuid import UUID

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models import CheckinLog, Guest, WelcomeEvent
from ..schemas import CheckinLogOut
from ..ws import manager
from ..auth.dependencies import require_permission

router = APIRouter(prefix="/api/checkin", tags=["checkin"])


def _now():
    return datetime.now(timezone.utc)


async def _broadcast_welcome(db: AsyncSession, workshop_id: uuid.UUID, guest: Guest):
    """Broadcast welcome event via WebSocket + save to welcome_events table."""
    we = WelcomeEvent(
        workshop_id=workshop_id,
        guest_id=guest.id,
        display_name=guest.full_name,
        display_message="Chào mừng anh/chị đến với Workshop",
        event_type="welcome",
    )
    db.add(we)
    await db.commit()
    await manager.broadcast({
        "type": "welcome",
        "workshop_id": str(workshop_id),
        "guest_id": str(guest.id),
        "display_name": guest.full_name,
        "display_message": we.display_message,
    })


# -----------------------------------------------------------------
# GET /api/checkin/logs
# -----------------------------------------------------------------
@router.get("/logs", response_model=list[CheckinLogOut], dependencies=[Depends(require_permission("checkin.read"))])
async def get_logs(
    workshop_id: uuid.UUID,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(CheckinLog)
            .where(CheckinLog.workshop_id == workshop_id)
            .order_by(CheckinLog.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    return [
        CheckinLogOut(
            id=r.id,
            guest_id=r.guest_id,
            method=r.method or "admin",
            status=r.status,
            checked_in_at=r.checked_in_at,
            checked_in_by=r.checked_in_by,
            note=r.note,
            created_at=r.created_at,
        )
        for r in rows
    ]


# -----------------------------------------------------------------
# POST /api/checkin/reset  (backward-compatible alias for uncheckin)
# -----------------------------------------------------------------
@router.post("/reset", dependencies=[Depends(require_permission("checkin.manage"))])
async def reset_checkin(
    guest_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Reset check-in status for a guest. Alias for /api/guests/{id}/uncheckin."""
    from ..redis_client import clear_dedup

    guest = await db.get(Guest, guest_id)
    if not guest:
        return {"error": "guest not found"}

    workshop_id = guest.workshop_id
    guest.checkin_status = "not_checked_in"
    guest.checked_in_at = None
    guest.local_updated_at = _now()
    await db.commit()
    await clear_dedup(workshop_id, guest.id)

    await db.refresh(guest)
    return {"guest_id": str(guest.id), "checkin_status": guest.checkin_status}


# -----------------------------------------------------------------
# GET /api/checkin/welcome/latest
# -----------------------------------------------------------------
@router.get("/welcome/latest")
async def get_latest_welcome(
    workshop_id: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Return the most recent welcome event for welcome display page.

    Khi truyền ``workshop_id`` (query string), chỉ trả event thuộc workshop đó.
    Khi không truyền, giữ hành vi cũ: trả event mới nhất toàn cục (phục vụ
    màn hình grid cũ).
    """
    stmt = select(WelcomeEvent).order_by(WelcomeEvent.created_at.desc()).limit(1)
    if workshop_id:
        try:
            stmt = stmt.where(WelcomeEvent.workshop_id == UUID(workshop_id))
        except ValueError:
            return None
    row = (await db.execute(stmt)).scalar_one_or_none()
    if not row:
        return None
    return {
        "id": str(row.id),
        "workshop_id": str(row.workshop_id),
        "guest_id": str(row.guest_id) if row.guest_id else None,
        "display_name": row.display_name,
        "display_message": row.display_message,
        "created_at": row.created_at,
    }
