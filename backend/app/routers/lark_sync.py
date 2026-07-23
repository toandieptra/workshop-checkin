import json
import logging
import uuid
from datetime import datetime, time, timezone, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..config import settings
from ..models import Guest, Workshop, WorkshopMedia, SyncLog
from ..services import lark_client
from ..services.lark_client import LarkError
from ..auth.dependencies import require_permission

logger = logging.getLogger("lark")
router = APIRouter(prefix="/api/lark", tags=["lark"])

# ===== Field names written to Lark registration table =====
F_FULL_NAME = "Họ và tên"
F_PHONE = "Số điện thoại"
F_BUSINESS_MODEL = "Mô hình kinh doanh"
F_TICKETS = "Số vé đăng ký"
F_WORKSHOP_SALE = "Workshop (sale)"
F_SOURCE = "Nguồn"
F_CREATOR = "Người tạo Web"

# ===== Field names written to Lark workshop config table =====
WF_NAME = "Workshop"
WF_DATE = "Ngày sự kiện"
WF_LOCATION = "Địa điểm sự kiện"
WF_BRANCH = "Chi Nhánh"
WF_MAPS = "Định Vị"
WF_SHORT_URL = "Short link đăng ký Workshop"
WF_IMAGES = "Ảnh WS"

# Lark timestamp (ms) lưu theo local VN (UTC+7)
_VN_TZ = timezone(timedelta(hours=7))

# ===== Sync status constants =====
SYNC_OK = "synced"
SYNC_PENDING_PUSH = "pending_push"
SYNC_ERROR = "error"


def _source_to_lark(source: str | None, detail: str | None) -> str:
    if source == "Khác" and detail:
        return f"Khác: {detail}"
    return source or ""


async def _log_sync(
    db: AsyncSession,
    direction: str,
    entity_type: str,
    entity_id: uuid.UUID | None,
    lark_record_id: str | None,
    status: str,
    error_message: str | None = None,
    payload: dict | None = None,
):
    log_entry = SyncLog(
        direction=direction,
        entity_type=entity_type,
        entity_id=entity_id,
        lark_record_id=lark_record_id,
        status=status,
        error_message=error_message,
        payload=json.dumps(payload) if payload else None,
    )
    db.add(log_entry)


async def _push_guest_to_lark(db: AsyncSession, guest: Guest) -> str | None:
    """Push guest to Lark. Creates record if no lark_record_id yet."""
    if guest.lark_record_id:
        return guest.lark_record_id
    if not settings.LARK_TABLE_REGISTRATIONS:
        raise HTTPException(400, "Chưa cấu hình LARK_TABLE_REGISTRATIONS")

    workshop = await db.get(Workshop, guest.workshop_id)
    if not workshop:
        raise HTTPException(404, "workshop not found")

    lark_workshop_name = workshop.lark_workshop_name or workshop.name
    if not workshop.lark_workshop_name:
        workshop.lark_workshop_name = lark_workshop_name

    fields = {
        F_FULL_NAME: guest.full_name,
        F_PHONE: guest.phone or "",
        F_BUSINESS_MODEL: guest.business_model or "",
        F_TICKETS: max(1, int(guest.party_size or 1)),
        F_WORKSHOP_SALE: lark_workshop_name,
        F_SOURCE: _source_to_lark(guest.source, guest.source_detail),
        F_CREATOR: guest.creator_name or "",
    }
    record_id = await lark_client.create_record(settings.LARK_TABLE_REGISTRATIONS, fields)
    guest.lark_record_id = record_id
    guest.sync_status = SYNC_OK
    guest.last_synced_at = datetime.now(timezone.utc)
    guest.sync_error = None
    await db.commit()
    return record_id


async def _update_guest_on_lark(db: AsyncSession, guest: Guest) -> str:
    """Write the current local guest state to its existing Lark record."""
    if not guest.lark_record_id:
        record_id = await _push_guest_to_lark(db, guest)
        if not record_id:
            raise LarkError("Lark create không trả record_id")
        return record_id
    if not settings.LARK_TABLE_REGISTRATIONS:
        raise HTTPException(400, "Chưa cấu hình LARK_TABLE_REGISTRATIONS")

    fields = {
        F_FULL_NAME: guest.full_name,
        F_PHONE: guest.phone or "",
        F_BUSINESS_MODEL: guest.business_model or "",
        F_TICKETS: max(1, int(guest.party_size or 1)),
        F_SOURCE: _source_to_lark(guest.source, guest.source_detail),
        F_CREATOR: guest.creator_name or "",
    }
    await lark_client.update_record(
        settings.LARK_TABLE_REGISTRATIONS,
        guest.lark_record_id,
        fields,
    )
    guest.sync_status = SYNC_OK
    guest.last_synced_at = datetime.now(timezone.utc)
    guest.sync_error = None
    await db.commit()
    return guest.lark_record_id


def _workshop_datetime_ms(workshop: Workshop) -> int | None:
    """Gộp event_date + event_time thành timestamp ms theo giờ VN (UTC+7).
    Đảo ngược _parse_date/_parse_time. Chỉ có ngày thì đặt 00:00."""
    if not workshop.event_date:
        return None
    t = workshop.event_time or time(0, 0)
    dt = datetime.combine(workshop.event_date, t, tzinfo=_VN_TZ)
    return int(dt.timestamp() * 1000)


async def _sync_workshop_images_to_lark(db: AsyncSession, workshop: Workshop) -> list[dict]:
    """Upload các ảnh local (chưa có lark_file_token) lên Lark, trả danh sách
    {"file_token": ...} cho toàn bộ ảnh có token để ghi vào field attachment."""
    media = (await db.execute(
        select(WorkshopMedia).where(WorkshopMedia.workshop_id == workshop.id)
        .order_by(WorkshopMedia.sort_order)
    )).scalars().all()

    tokens: list[dict] = []
    for m in media:
        mime = (m.mime_type or "").lower()
        if not mime.startswith("image/"):
            continue
        if not m.lark_file_token:
            try:
                rel = (m.file_url or "")
                if not rel.startswith("/uploads/"):
                    continue
                path = Path(settings.UPLOAD_DIR) / rel[len("/uploads/"):]
                if not path.is_file():
                    continue
                data = path.read_bytes()
                token = await lark_client.upload_bitable_media(
                    m.file_name or path.name, data, m.mime_type,
                )
                m.lark_file_token = token
            except Exception as e:
                logger.warning("upload workshop image to lark failed media=%s: %s", m.id, e)
                continue
        tokens.append({"file_token": m.lark_file_token})
    return tokens


async def _push_workshop_to_lark(db: AsyncSession, workshop: Workshop) -> str | None:
    """Push workshop local -> Lark config table.

    - Tạo record nếu chưa có (dò theo tên trước để tránh trùng), ngược lại update.
    - Đẩy name/ngày-giờ/địa điểm/chi nhánh/maps/short_url + ảnh (best-effort).
    """
    if not settings.LARK_WRITEBACK_ENABLED or not settings.LARK_TABLE_WORKSHOPS:
        return None

    table_id = settings.LARK_TABLE_WORKSHOPS
    lark_name = workshop.lark_workshop_name or workshop.name
    if not workshop.lark_workshop_name:
        workshop.lark_workshop_name = lark_name

    fields: dict = {WF_NAME: lark_name}
    if workshop.location:
        fields[WF_LOCATION] = workshop.location
    if workshop.branch:
        fields[WF_BRANCH] = workshop.branch
    if workshop.registration_short_url:
        fields[WF_SHORT_URL] = workshop.registration_short_url
    if workshop.maps_url:
        fields[WF_MAPS] = {"link": workshop.maps_url, "text": workshop.maps_url}
    dt_ms = _workshop_datetime_ms(workshop)
    if dt_ms is not None:
        fields[WF_DATE] = dt_ms
    # Ảnh (best-effort, không chặn push text)
    try:
        img_tokens = await _sync_workshop_images_to_lark(db, workshop)
        if img_tokens:
            fields[WF_IMAGES] = img_tokens
    except Exception as e:
        logger.warning("sync workshop images to lark failed workshop=%s: %s", workshop.id, e)

    # Chống trùng: dò record theo tên nếu chưa có record_id
    record_id = workshop.lark_record_id
    if not record_id:
        try:
            recs = await lark_client.list_records(table_id)
            for rec in recs:
                if lark_client.field_text(rec.get("fields", {}), WF_NAME) == lark_name:
                    record_id = rec.get("record_id")
                    break
        except Exception as e:
            logger.warning("lookup workshop on lark failed name=%s: %s", lark_name, e)

    try:
        if record_id:
            await lark_client.update_record(table_id, record_id, fields)
        else:
            record_id = await lark_client.create_record(table_id, fields)
        workshop.lark_record_id = record_id
        workshop.last_synced_at = datetime.now(timezone.utc)
        await _log_sync(db, "local_to_lark", "workshop", workshop.id, record_id, SYNC_OK)
        await db.commit()
        return record_id
    except Exception as e:
        await _log_sync(db, "local_to_lark", "workshop", workshop.id, record_id, SYNC_ERROR, error_message=str(e))
        await db.commit()
        raise


# -----------------------------------------------------------------
# Push logic (Local → Lark)
# -----------------------------------------------------------------

async def _sync_push_to_lark(db: AsyncSession, workshop_id: uuid.UUID) -> dict:
    """Push pending or failed local guests to Lark. Returns stats."""
    workshop = await db.get(Workshop, workshop_id)
    if not workshop:
        return {"total": 0, "pushed": 0, "errors": 0, "error_details": []}

    guests = (await db.execute(
        select(Guest).where(
            Guest.workshop_id == workshop_id,
            Guest.sync_status.in_((SYNC_PENDING_PUSH, SYNC_ERROR)),
            Guest.deleted_at.is_(None),
        )
    )).scalars().all()

    pushed = errors = 0
    error_details: list[str] = []

    for g in guests:
        try:
            await _update_guest_on_lark(db, g)
            pushed += 1
        except Exception as e:
            errors += 1
            msg = f"{g.full_name}: {e}"
            error_details.append(msg)
            g.sync_status = SYNC_ERROR
            g.sync_error = str(e)
            await _log_sync(db, "local_to_lark", "guest", g.id, g.lark_record_id, SYNC_ERROR, error_message=str(e))
            logger.warning("push guest %s to lark failed: %s", g.id, e)

    await db.commit()
    return {"total": len(guests), "pushed": pushed, "errors": errors, "error_details": error_details[:20]}


# -----------------------------------------------------------------
# FastAPI Router endpoints
# -----------------------------------------------------------------

@router.get("/health")
async def lark_health():
    try:
        token = await lark_client.get_tenant_token()
        return {"ok": True, "token_prefix": token[:8] + "..."}
    except Exception as e:
        raise HTTPException(502, f"Lark không kết nối được: {e}")


@router.post("/sync/push/{workshop_id}", dependencies=[Depends(require_permission("lark.sync"))])
async def sync_push(workshop_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Push pending or failed guests to Lark."""
    workshop = await db.get(Workshop, workshop_id)
    if not workshop:
        raise HTTPException(404, "workshop not found")
    result = await _sync_push_to_lark(db, workshop_id)
    return {"workshop_id": str(workshop_id), **result}


@router.post("/sync/push-guest/{guest_id}", dependencies=[Depends(require_permission("lark.sync"))])
async def sync_push_guest(guest_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Retry one guest from the local database to Lark."""
    guest = await db.get(Guest, guest_id)
    if not guest or guest.deleted_at is not None:
        raise HTTPException(404, "guest not found")
    try:
        record_id = await _update_guest_on_lark(db, guest)
        await _log_sync(db, "local_to_lark", "guest", guest.id, record_id, SYNC_OK)
        await db.commit()
        return {"guest_id": str(guest_id), "lark_record_id": record_id, "pushed": True}
    except Exception as e:
        guest.sync_status = SYNC_ERROR
        guest.sync_error = str(e)
        await _log_sync(db, "local_to_lark", "guest", guest.id, guest.lark_record_id, SYNC_ERROR, error_message=str(e))
        await db.commit()
        raise HTTPException(502, f"Đẩy khách lên Lark thất bại: {e}")


@router.post("/sync/push-workshop/{workshop_id}", dependencies=[Depends(require_permission("lark.sync"))])
async def sync_push_workshop(workshop_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Đẩy 1 workshop local lên Lark config table (thủ công / backup)."""
    if not settings.LARK_WRITEBACK_ENABLED:
        raise HTTPException(400, "Lark writeback đang tắt (LARK_WRITEBACK_ENABLED=false)")
    if not settings.LARK_TABLE_WORKSHOPS:
        raise HTTPException(400, "Chưa cấu hình LARK_TABLE_WORKSHOPS")
    workshop = await db.get(Workshop, workshop_id)
    if not workshop:
        raise HTTPException(404, "workshop not found")
    try:
        record_id = await _push_workshop_to_lark(db, workshop)
        return {"workshop_id": str(workshop_id), "lark_record_id": record_id, "pushed": True}
    except Exception as e:
        raise HTTPException(502, f"Đẩy workshop lên Lark thất bại: {e}")


@router.get("/sync/status", dependencies=[Depends(require_permission("lark.read"))])
async def sync_status(workshop_id: uuid.UUID | None = None, db: AsyncSession = Depends(get_db)):
    """Return sync status counts."""
    query = select(func.count(Guest.id), Guest.sync_status)
    if workshop_id:
        query = query.where(Guest.workshop_id == workshop_id, Guest.deleted_at.is_(None))
    else:
        query = query.where(Guest.deleted_at.is_(None))
    rows = (await db.execute(query.group_by(Guest.sync_status))).all()
    counts = {r[1]: r[0] for r in rows}
    last_sync = (await db.execute(select(func.max(SyncLog.created_at)))).scalar_one_or_none()
    return {
        "pending_push": counts.get(SYNC_PENDING_PUSH, 0),
        "errors": counts.get(SYNC_ERROR, 0),
        "synced": counts.get(SYNC_OK, 0),
        "last_sync_at": last_sync,
    }
