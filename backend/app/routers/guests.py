import logging
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..config import settings
from ..models import CheckinLog, Guest, WelcomeEvent, Workshop
from ..schemas import (
    GuestOut, GuestUpdate, GuestUpdateResult, CheckinResult,
    CheckinSelfRequest, LookupByPhoneResult, SelfRegisterRequest, SelfRegisterResult,
)
from ..services import lark_client
from ..redis_client import is_duplicate, mark_checked_in, clear_dedup
from ..ws import manager
from .lark_sync import _push_guest_to_lark

router = APIRouter(prefix="/api", tags=["guests"])
logger = logging.getLogger("guests")


def _now():
    return datetime.now(timezone.utc)


def normalize_phone(phone: str) -> str:
    """Chuẩn hoá SĐT: bỏ hết ký tự không phải số, convert +84/84 prefix → 0.

    Ví dụ: "+84 909 123 456" -> "0909123456"
           "84909123456"      -> "0909123456"
           "0909.123.456"     -> "0909123456"
    """
    digits = re.sub(r"\D", "", phone or "")
    if digits.startswith("84") and len(digits) >= 11:
        digits = "0" + digits[2:]
    return digits


async def _load_guest(db: AsyncSession, guest_id: uuid.UUID) -> Guest:
    g = await db.get(Guest, guest_id)
    if not g:
        raise HTTPException(404, "guest not found")
    return g


async def _lark_writeback_checkin(guest: Guest, checked: bool) -> str | None:
    """Write Check-In field to Lark Base."""
    if not settings.LARK_WRITEBACK_ENABLED:
        return None
    if not guest.lark_record_id or not settings.LARK_TABLE_REGISTRATIONS:
        return None
    try:
        await lark_client.update_record(
            settings.LARK_TABLE_REGISTRATIONS,
            guest.lark_record_id,
            {"Check-In": checked},
        )
        return None
    except Exception as e1:
        try:
            await lark_client.update_record(
                settings.LARK_TABLE_REGISTRATIONS,
                guest.lark_record_id,
                {"Check-in": checked},
            )
            return None
        except Exception as e2:
            logger.warning(
                "lark writeback failed for guest %s: %s (Check-In) and %s (Check-in)",
                guest.id, e1, e2,
            )
            return f"{e1} / {e2}"


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


async def _do_checkin(
    db: AsyncSession,
    guest: Guest,
    actual_party_size: int | None,
    method: str,
) -> tuple[Guest, str | None]:
    """Core check-in logic, dùng chung cho admin flow và self QR flow.

    Returns (guest, lark_error).
    Quy tắc cộng dồn:
      - Nếu chưa check-in: lần đầu, đặt actual_party_size, tạo log.
      - Nếu đã check-in: cộng dồn actual_party_size vào giá trị hiện tại,
        KHÔNG đổi checked_in_at, KHÔNG tạo log mới (chỉ update note cộng dồn).
    """
    added = max(1, actual_party_size or guest.party_size or 1)

    if guest.checkin_status == "checked_in":
        # Cộng dồn — giữ checked_in_at nguyên thuỷ (theo yêu cầu A)
        previous = guest.actual_party_size or guest.party_size or 1
        guest.actual_party_size = previous + added
        guest.note = (guest.note or "").rstrip()
        if guest.note:
            guest.note += " | "
        guest.note += f"Cộng dồn tham gia: +{added} (tổng {guest.actual_party_size}) lúc {_now().isoformat()}"
        guest.local_updated_at = _now()
        await db.commit()
        # Lark writeback (giữ true, không đổi)
        lark_error = await _lark_writeback_checkin(guest, True)
        if lark_error:
            guest.sync_status = "error"
            guest.sync_error = lark_error
        else:
            guest.sync_status = "synced"
            guest.last_synced_at = _now()
            guest.sync_error = None
        await db.commit()
        await db.refresh(guest)
        return guest, lark_error

    # Lần đầu check-in
    guest.checkin_status = "checked_in"
    guest.checked_in_at = _now()
    guest.actual_party_size = added
    guest.local_updated_at = _now()

    log = CheckinLog(
        workshop_id=guest.workshop_id,
        guest_id=guest.id,
        method=method,
        status="checked_in",
        checked_in_at=_now(),
        checked_in_by=method,
        note=f"actual_party_size={added}",
    )
    db.add(log)
    await db.commit()
    await mark_checked_in(guest.workshop_id, guest.id)

    lark_error = await _lark_writeback_checkin(guest, True)
    if lark_error:
        guest.sync_status = "error"
        guest.sync_error = lark_error
    else:
        guest.sync_status = "synced"
        guest.last_synced_at = _now()
        guest.sync_error = None
    await db.commit()

    await _broadcast_welcome(db, guest.workshop_id, guest)

    await db.refresh(guest)
    return guest, lark_error


# =================================================================
# Self check-in (QR flow — khách tự quét)  PHẢI ĐẶT TRƯỚC /guests/{guest_id}
# để FastAPI match đúng route (static path > dynamic path)
# =================================================================

@router.get("/guests/lookup-by-phone", response_model=LookupByPhoneResult)
async def lookup_by_phone(
    phone: str = Query(..., min_length=3),
    workshop_slug: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Tìm khách theo SĐT trong 1 workshop cụ thể.

    Trả 3 loại kết quả:
      - found=true: khách thuộc workshop đó
      - found=false, reason="not_in_workshop": SĐT không có trong workshop này
      - found=false, reason="wrong_workshop": SĐT có nhưng thuộc workshop khác
    """
    norm = normalize_phone(phone)
    if not norm:
        raise HTTPException(400, "Số điện thoại không hợp lệ")

    workshop = (await db.execute(
        select(Workshop).where(Workshop.slug == workshop_slug)
    )).scalar_one_or_none()
    if not workshop:
        raise HTTPException(404, "Workshop không tồn tại")

    # Tìm khách có phone khớp (normalized) trong TẤT CẢ workshop, không phải bó hẹp.
    rows = (await db.execute(text("""
        SELECT id, workshop_id, full_name, phone, party_size,
               checkin_status, actual_party_size, lark_record_id,
               email, company, business_model, role_title, guest_type,
               note, checked_in_at, registered_at, created_at,
               local_updated_at, lark_updated_at, last_synced_at,
               sync_status, sync_error
        FROM guests
        WHERE deleted_at IS NULL
          AND phone IS NOT NULL
          AND regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = :norm
        LIMIT 1
    """), {"norm": norm})).first()

    if not rows:
        return LookupByPhoneResult(
            found=False, reason="not_in_workshop", workshop_name=workshop.name,
        )

    guest_workshop_id = rows.workshop_id
    if guest_workshop_id != workshop.id:
        other = await db.get(Workshop, guest_workshop_id)
        return LookupByPhoneResult(
            found=False,
            reason="wrong_workshop",
            workshop_name=workshop.name,
            other_workshop_name=other.name if other else None,
            other_workshop_slug=other.slug if other else None,
        )

    guest = await db.get(Guest, rows.id)
    return LookupByPhoneResult(
        found=True,
        reason="ok",
        workshop_name=workshop.name,
        registered_party_size=guest.party_size,
        guest=GuestOut.model_validate(guest),
    )


@router.post("/guests/self-register-and-checkin", response_model=SelfRegisterResult)
async def self_register_and_checkin(
    body: SelfRegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    """Khách không có trong DS đăng ký — cho phép đăng ký nhanh + check-in luôn."""
    workshop = (await db.execute(
        select(Workshop).where(Workshop.slug == body.workshop_slug)
    )).scalar_one_or_none()
    if not workshop:
        raise HTTPException(404, "Workshop không tồn tại")

    if not body.full_name.strip():
        raise HTTPException(400, "Vui lòng nhập họ tên")
    actual = max(1, body.actual_party_size)

    guest = Guest(
        workshop_id=workshop.id,
        full_name=body.full_name.strip(),
        phone=body.phone.strip(),
        email=body.email or None,
        company=body.company or None,
        business_model=body.business_model or None,
        party_size=actual,
        actual_party_size=actual,
        checkin_status="checked_in",
        checked_in_at=_now(),
        registered_at=_now(),
        local_updated_at=_now(),
        sync_status="pending_push",
        note="Đăng ký ngoài danh sách qua QR — staff sẽ xác minh sau",
    )
    db.add(guest)
    await db.flush()

    log = CheckinLog(
        workshop_id=workshop.id,
        guest_id=guest.id,
        method="self_qr",
        status="checked_in",
        checked_in_at=_now(),
        checked_in_by="self_qr",
        note=f"Self-register: actual_party_size={actual}",
    )
    db.add(log)
    await db.commit()
    await db.refresh(guest)

    await mark_checked_in(workshop.id, guest.id)
    await _broadcast_welcome(db, workshop.id, guest)

    return SelfRegisterResult(
        guest=GuestOut.model_validate(guest),
        lark_synced=False,
        warning="Bạn đang đăng ký ngoài danh sách. Nhân viên sẽ xác minh sau.",
    )


# =================================================================
# Guest CRUD (giữ nguyên flow admin)
# =================================================================

@router.get("/guests/{guest_id}", response_model=GuestOut)
async def get_guest(guest_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    return await _load_guest(db, guest_id)


@router.patch("/guests/{guest_id}", response_model=GuestUpdateResult)
async def update_guest(
    guest_id: uuid.UUID,
    body: GuestUpdate,
    sync_lark: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    g = await _load_guest(db, guest_id)
    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(g, k, v)
    g.local_updated_at = _now()
    await db.commit()

    lark_error: str | None = None
    if sync_lark and settings.LARK_WRITEBACK_ENABLED:
        try:
            if g.lark_record_id:
                fields = {
                    "Họ và tên": g.full_name,
                    "Số điện thoại": g.phone or "",
                    "Mô hình kinh doanh": g.business_model or "",
                    "Số vé đăng ký": max(1, int(g.party_size or 1)),
                }
                await lark_client.update_record(
                    settings.LARK_TABLE_REGISTRATIONS, g.lark_record_id, fields,
                )
                g.sync_status = "synced"
                g.last_synced_at = _now()
                await db.commit()
            else:
                await _push_guest_to_lark(db, g)
                g.sync_status = "synced"
                await db.commit()
        except Exception as e:
            lark_error = str(e)
            g.sync_status = "error"
            g.sync_error = lark_error
            await db.commit()
            logger.warning("sync guest %s to lark failed: %s", guest_id, e)

    await db.refresh(g)
    return GuestUpdateResult(
        guest=GuestOut.model_validate(g),
        lark_synced=(lark_error is None),
        lark_error=lark_error,
    )


@router.delete("/guests/{guest_id}", status_code=204)
async def delete_guest(guest_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    g = await db.get(Guest, guest_id)
    if not g:
        raise HTTPException(404, "guest not found")
    g.deleted_at = _now()
    g.local_updated_at = _now()
    await db.commit()


# =================================================================
# Admin check-in (giữ tương thích — chấp nhận optional actual_party_size)
# =================================================================

@router.post("/guests/{guest_id}/checkin", response_model=CheckinResult)
async def checkin_guest(
    guest_id: uuid.UUID,
    body: CheckinSelfRequest | None = None,
    db: AsyncSession = Depends(get_db),
):
    guest = await _load_guest(db, guest_id)
    actual = body.actual_party_size if body else None
    guest, lark_error = await _do_checkin(db, guest, actual, method="admin")
    return CheckinResult(
        guest=GuestOut.model_validate(guest),
        lark_synced=(lark_error is None),
        lark_error=lark_error,
    )


@router.post("/guests/{guest_id}/uncheckin", response_model=CheckinResult)
async def uncheckin_guest(guest_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    guest = await _load_guest(db, guest_id)

    guest.checkin_status = "not_checked_in"
    guest.checked_in_at = None
    guest.actual_party_size = None
    guest.local_updated_at = _now()

    log = CheckinLog(
        workshop_id=guest.workshop_id,
        guest_id=guest.id,
        method="admin",
        status="unchecked",
        checked_in_at=None,
        checked_in_by="admin",
    )
    db.add(log)
    await db.commit()
    await clear_dedup(guest.workshop_id, guest.id)

    lark_error = await _lark_writeback_checkin(guest, False)
    if lark_error:
        guest.sync_status = "error"
        guest.sync_error = lark_error
        await db.commit()
    else:
        guest.sync_status = "synced"
        guest.last_synced_at = _now()
        guest.sync_error = None
        await db.commit()

    await db.refresh(guest)
    return CheckinResult(
        guest=GuestOut.model_validate(guest),
        lark_synced=(lark_error is None),
        lark_error=lark_error,
    )


# =================================================================
# Resolve slug (cho QR URL /checkin-self?w=<slug>)
# Dùng path riêng (/public/workshops/by-slug/...) để không bị
# /api/workshops/{workshop_id} (UUID) match nhầm.
# =================================================================

@router.get("/public/workshops/by-slug/{slug}")
async def get_workshop_by_slug(slug: str, db: AsyncSession = Depends(get_db)):
    from ..schemas import WorkshopOut
    w = (await db.execute(
        select(Workshop).where(Workshop.slug == slug)
    )).scalar_one_or_none()
    if not w:
        raise HTTPException(404, "Workshop không tồn tại")
    return WorkshopOut.model_validate(w)