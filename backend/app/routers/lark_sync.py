import logging
import re
import uuid
from datetime import datetime, date, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..config import settings
from ..models import Workshop, Guest
from ..services import lark_client

logger = logging.getLogger("lark")
router = APIRouter(prefix="/api/lark", tags=["lark"])

# ===== Tên field trong bảng đăng ký Lark (CRM2026) =====
F_FULL_NAME = "Họ và tên"
F_PHONE = "Số điện thoại"
F_BUSINESS_MODEL = "Mô hình kinh doanh"
F_TICKETS = "Số vé đăng ký"
F_WORKSHOP = "Workshop (final)"
F_WORKSHOP_SALE = "Workshop (sale)"
F_REGISTERED_AT = "Ngày tạo"
F_REGISTERED_AT_FALLBACK = "ngày tạo"
F_CHECKIN = "Check-in"

# ===== Tên field trong bảng cấu hình workshop =====
WF_NAME = "Workshop"
WF_DATE = "Ngày sự kiện"
WF_LOCATION = "Địa điểm sự kiện"


class SyncRequest(BaseModel):
    lark_workshop_name: str
    target_workshop_id: uuid.UUID | None = None


class SyncResult(BaseModel):
    workshop_id: uuid.UUID
    workshop_name: str
    total_from_lark: int
    created: int
    updated: int
    skipped: int


class PushUnsyncedResult(BaseModel):
    workshop_id: uuid.UUID
    total: int
    created: int
    failed: int
    errors: list[str] = []


def _slugify(text: str) -> str:
    s = text.lower().strip()
    # bỏ dấu tiếng Việt cơ bản
    rep = {
        "àáảãạăằắẳẵặâầấẩẫậ": "a", "èéẻẽẹêềếểễệ": "e", "ìíỉĩị": "i",
        "òóỏõọôồốổỗộơờớởỡợ": "o", "ùúủũụưừứửữự": "u", "ỳýỷỹỵ": "y", "đ": "d",
    }
    for chars, r in rep.items():
        for c in chars:
            s = s.replace(c, r)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "workshop"


def _parse_date(raw) -> date | None:
    if raw is None:
        return None
    # Lark date thường là epoch ms
    if isinstance(raw, (int, float)):
        try:
            return datetime.fromtimestamp(raw / 1000, tz=timezone.utc).date()
        except (ValueError, OSError):
            return None
    if isinstance(raw, str):
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
            try:
                return datetime.strptime(raw.strip(), fmt).date()
            except ValueError:
                continue
    return None


def _parse_lark_datetime_ms(raw) -> datetime | None:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        try:
            return datetime.fromtimestamp(raw / 1000, tz=timezone.utc)
        except (ValueError, OSError):
            return None
    if isinstance(raw, str):
        s = raw.strip()
        if s.isdigit():
            return _parse_lark_datetime_ms(int(s))
        for fmt in ("%Y/%m/%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                dt = datetime.strptime(s, fmt)
                return dt.replace(tzinfo=timezone.utc)
            except ValueError:
                continue
    return None


@router.get("/health")
async def lark_health():
    """Kiểm tra token Lark lấy được không."""
    try:
        token = await lark_client.get_tenant_token()
        return {"ok": True, "token_prefix": token[:8] + "..."}
    except Exception as e:
        raise HTTPException(502, f"Lark không kết nối được: {e}")


@router.get("/workshops")
async def list_lark_workshops():
    """List workshop từ bảng cấu hình Lark (cho dropdown admin)."""
    if not settings.LARK_TABLE_WORKSHOPS:
        raise HTTPException(400, "Chưa cấu hình LARK_TABLE_WORKSHOPS")
    records = await lark_client.list_records(settings.LARK_TABLE_WORKSHOPS)
    out = []
    seen = set()
    for rec in records:
        f = rec.get("fields", {})
        name = lark_client.field_text(f, WF_NAME)
        if not name or name in seen:
            continue
        seen.add(name)
        out.append({
            "lark_workshop_name": name,
            "event_date": _parse_date(f.get(WF_DATE)).isoformat() if _parse_date(f.get(WF_DATE)) else None,
            "location": lark_client.field_text(f, WF_LOCATION),
        })
    return out


async def _resolve_workshop(db: AsyncSession, body: SyncRequest) -> Workshop:
    # 1. target explicit
    if body.target_workshop_id:
        w = await db.get(Workshop, body.target_workshop_id)
        if not w:
            raise HTTPException(404, "target workshop not found")
        if not w.lark_workshop_name:
            w.lark_workshop_name = body.lark_workshop_name
        return w
    # 2. match theo lark_workshop_name
    w = (await db.execute(
        select(Workshop).where(Workshop.lark_workshop_name == body.lark_workshop_name)
    )).scalar_one_or_none()
    if w:
        return w
    # 3. auto-create từ metadata Lark
    meta = None
    if settings.LARK_TABLE_WORKSHOPS:
        recs = await lark_client.list_records(settings.LARK_TABLE_WORKSHOPS)
        for rec in recs:
            f = rec.get("fields", {})
            if lark_client.field_text(f, WF_NAME) == body.lark_workshop_name:
                meta = f
                break
    slug_base = _slugify(body.lark_workshop_name)
    slug = slug_base
    n = 1
    while (await db.execute(select(Workshop).where(Workshop.slug == slug))).scalar_one_or_none():
        n += 1
        slug = f"{slug_base}-{n}"
    w = Workshop(
        name=body.lark_workshop_name,
        slug=slug,
        event_date=_parse_date(meta.get(WF_DATE)) if meta else None,
        location=lark_client.field_text(meta, WF_LOCATION) if meta else None,
        lark_workshop_name=body.lark_workshop_name,
    )
    db.add(w)
    await db.flush()
    return w


async def push_guest_to_lark(db: AsyncSession, guest: Guest) -> str | None:
    """Đẩy 1 khách app lên Lark nếu chưa có lark_record_id. Best-effort caller xử lý lỗi."""
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
    }
    record_id = await lark_client.create_record(settings.LARK_TABLE_REGISTRATIONS, fields)
    guest.lark_record_id = record_id
    await db.commit()
    return record_id


@router.post("/sync", response_model=SyncResult)
async def sync_workshop(body: SyncRequest, db: AsyncSession = Depends(get_db)):
    if not settings.LARK_TABLE_REGISTRATIONS:
        raise HTTPException(400, "Chưa cấu hình LARK_TABLE_REGISTRATIONS")

    workshop = await _resolve_workshop(db, body)

    # kéo record đăng ký, lọc theo Workshop (final)
    records = await lark_client.list_records(settings.LARK_TABLE_REGISTRATIONS)
    matched = [
        rec for rec in records
        if lark_client.field_text(rec.get("fields", {}), F_WORKSHOP) == body.lark_workshop_name
    ]

    # map lark_record_id -> guest hiện có trong workshop
    existing = (await db.execute(
        select(Guest).where(
            Guest.workshop_id == workshop.id,
            Guest.lark_record_id.is_not(None),
        )
    )).scalars().all()
    by_lark = {g.lark_record_id: g for g in existing}

    created = updated = skipped = 0
    for rec in matched:
        rid = rec.get("record_id")
        f = rec.get("fields", {})
        full_name = lark_client.field_text(f, F_FULL_NAME)
        if not rid or not full_name:
            skipped += 1
            continue
        phone = lark_client.field_text(f, F_PHONE)
        business_model = lark_client.field_text(f, F_BUSINESS_MODEL)
        party_size = lark_client.field_int(f, F_TICKETS, default=1)
        registered_at = _parse_lark_datetime_ms(f.get(F_REGISTERED_AT) or f.get(F_REGISTERED_AT_FALLBACK))

        g = by_lark.get(rid)
        if g:
            g.full_name = full_name
            g.phone = phone
            g.business_model = business_model
            g.party_size = party_size
            if registered_at:
                g.registered_at = registered_at
            updated += 1
        else:
            g = Guest(
                workshop_id=workshop.id,
                full_name=full_name,
                phone=phone,
                business_model=business_model,
                party_size=party_size,
                lark_record_id=rid,
                registered_at=registered_at,
                consent_face_recognition=True,
            )
            db.add(g)
            created += 1

    await db.commit()
    return SyncResult(
        workshop_id=workshop.id,
        workshop_name=workshop.name,
        total_from_lark=len(matched),
        created=created,
        updated=updated,
        skipped=skipped,
    )


@router.post("/push-unsynced/{workshop_id}", response_model=PushUnsyncedResult)
async def push_unsynced(workshop_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    workshop = await db.get(Workshop, workshop_id)
    if not workshop:
        raise HTTPException(404, "workshop not found")

    guests = (await db.execute(
        select(Guest).where(
            Guest.workshop_id == workshop_id,
            Guest.lark_record_id.is_(None),
        ).order_by(Guest.full_name)
    )).scalars().all()

    created = failed = 0
    errors: list[str] = []
    for guest in guests:
        try:
            await push_guest_to_lark(db, guest)
            created += 1
        except Exception as e:
            failed += 1
            errors.append(f"{guest.full_name}: {e}")
            logger.warning("push guest to lark failed for %s: %s", guest.id, e)

    return PushUnsyncedResult(
        workshop_id=workshop_id,
        total=len(guests),
        created=created,
        failed=failed,
        errors=errors[:10],
    )
