import logging
import re
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models import Guest, RegistrationForm, RegistrationFormWorkshop, RegistrationSubmission, Workshop
from ..schemas import (
    GuestOut,
    RegistrationFormCreate,
    RegistrationFormOut,
    RegistrationFormPublic,
    RegistrationFormUpdate,
    RegistrationSubmitRequest,
    RegistrationSubmitResult,
    RegistrationWorkshopOption,
)

logger = logging.getLogger("registration_forms")
router = APIRouter(prefix="/api", tags=["registration-forms"])

# Regex SĐT Việt Nam: cho phép số, khoảng trắng, +, -, (), . — 9-15 ký tự thô.
_PHONE_RE = re.compile(r"^[\d\s\-+().]{9,15}$")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_phone(phone: str) -> str:
    """Chuẩn hoá SĐT: bỏ ký tự không phải số, +84/84 prefix → 0."""
    digits = re.sub(r"\D", "", phone or "")
    if digits.startswith("84") and len(digits) >= 11:
        digits = "0" + digits[2:]
    return digits


async def _submission_count(db: AsyncSession, form_id: uuid.UUID) -> int:
    return (await db.execute(
        select(func.count(RegistrationSubmission.id)).where(
            RegistrationSubmission.form_id == form_id
        )
    )).scalar_one()


async def _form_workshops(db: AsyncSession, form: RegistrationForm) -> list[Workshop]:
    """Danh sách workshop của form; fallback về form.workshop_id cho form cũ."""
    workshops = (await db.execute(
        select(Workshop)
        .join(RegistrationFormWorkshop, RegistrationFormWorkshop.workshop_id == Workshop.id)
        .where(RegistrationFormWorkshop.form_id == form.id)
        .order_by(Workshop.event_date.asc().nulls_last(), Workshop.name.asc())
    )).scalars().all()
    if workshops:
        return workshops
    fallback = await db.get(Workshop, form.workshop_id)
    return [fallback] if fallback else []


def _option(w: Workshop) -> RegistrationWorkshopOption:
    return RegistrationWorkshopOption(
        id=w.id,
        name=w.name,
        event_date=w.event_date,
        location=w.location,
    )


async def _to_out(db: AsyncSession, form: RegistrationForm) -> RegistrationFormOut:
    workshops = await _form_workshops(db, form)
    primary = workshops[0] if workshops else await db.get(Workshop, form.workshop_id)
    return RegistrationFormOut(
        id=form.id,
        token=form.token,
        workshop_id=form.workshop_id,
        workshop_name=primary.name if primary else None,
        workshops=[_option(w) for w in workshops],
        greeting=form.greeting,
        is_active=form.is_active,
        submission_count=await _submission_count(db, form.id),
        created_at=form.created_at,
        updated_at=form.updated_at,
    )


async def _validate_workshop_ids(db: AsyncSession, ids: list[uuid.UUID]) -> list[Workshop]:
    unique_ids = list(dict.fromkeys(ids))
    if not unique_ids:
        raise HTTPException(400, "Vui lòng chọn ít nhất 1 workshop")
    workshops = (await db.execute(
        select(Workshop).where(Workshop.id.in_(unique_ids))
    )).scalars().all()
    found = {w.id for w in workshops}
    missing = [str(i) for i in unique_ids if i not in found]
    if missing:
        raise HTTPException(404, "workshop not found: " + ", ".join(missing))
    return [w for i in unique_ids for w in workshops if w.id == i]


async def _replace_form_workshops(db: AsyncSession, form: RegistrationForm, workshop_ids: list[uuid.UUID]) -> None:
    await db.execute(delete(RegistrationFormWorkshop).where(RegistrationFormWorkshop.form_id == form.id))
    for wid in workshop_ids:
        db.add(RegistrationFormWorkshop(form_id=form.id, workshop_id=wid))


# -----------------------------------------------------------------
# Admin CRUD
# -----------------------------------------------------------------

@router.get("/registration-forms", response_model=list[RegistrationFormOut])
async def list_registration_forms(db: AsyncSession = Depends(get_db)):
    forms = (await db.execute(
        select(RegistrationForm).order_by(RegistrationForm.created_at.desc())
    )).scalars().all()
    return [await _to_out(db, f) for f in forms]


@router.post("/registration-forms", response_model=RegistrationFormOut, status_code=201)
async def create_registration_form(
    body: RegistrationFormCreate,
    db: AsyncSession = Depends(get_db),
):
    workshop_ids = body.workshop_ids or ([body.workshop_id] if body.workshop_id else [])
    workshops = await _validate_workshop_ids(db, workshop_ids)
    primary = workshops[0]

    form = RegistrationForm(
        token=secrets.token_hex(16),
        workshop_id=primary.id,  # backward-compatible primary workshop
        greeting=(body.greeting or None),
        is_active=True,
        created_by="admin",
    )
    db.add(form)
    await db.flush()
    await _replace_form_workshops(db, form, [w.id for w in workshops])
    await db.commit()
    await db.refresh(form)
    return await _to_out(db, form)


@router.patch("/registration-forms/{form_id}", response_model=RegistrationFormOut)
async def update_registration_form(
    form_id: uuid.UUID,
    body: RegistrationFormUpdate,
    db: AsyncSession = Depends(get_db),
):
    form = await db.get(RegistrationForm, form_id)
    if not form:
        raise HTTPException(404, "form not found")
    changes = body.model_dump(exclude_unset=True)
    if "greeting" in changes:
        form.greeting = changes["greeting"] or None
    if "is_active" in changes and changes["is_active"] is not None:
        form.is_active = changes["is_active"]
    if "workshop_ids" in changes and changes["workshop_ids"] is not None:
        workshops = await _validate_workshop_ids(db, changes["workshop_ids"])
        form.workshop_id = workshops[0].id
        await _replace_form_workshops(db, form, [w.id for w in workshops])
    form.updated_at = _now()
    await db.commit()
    await db.refresh(form)
    return await _to_out(db, form)


@router.delete("/registration-forms/{form_id}", status_code=204)
async def delete_registration_form(form_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    form = await db.get(RegistrationForm, form_id)
    if not form:
        raise HTTPException(404, "form not found")
    await db.delete(form)
    await db.commit()


# -----------------------------------------------------------------
# Public (khách truy cập qua link/QR)
# -----------------------------------------------------------------

@router.get("/public/registration-forms/{token}", response_model=RegistrationFormPublic)
async def get_public_registration_form(token: str, db: AsyncSession = Depends(get_db)):
    form = (await db.execute(
        select(RegistrationForm).where(RegistrationForm.token == token)
    )).scalar_one_or_none()
    if not form:
        raise HTTPException(404, "Form không tồn tại")
    workshops = await _form_workshops(db, form)
    if not workshops:
        raise HTTPException(404, "Workshop không tồn tại")
    primary = workshops[0]
    return RegistrationFormPublic(
        token=form.token,
        greeting=form.greeting,
        is_active=form.is_active,
        workshop_id=primary.id,
        workshop_name=primary.name,
        workshop_event_date=primary.event_date,
        workshop_location=primary.location,
        workshops=[_option(w) for w in workshops],
    )


@router.post(
    "/public/registration-forms/{token}/submit",
    response_model=RegistrationSubmitResult,
    status_code=201,
)
async def submit_registration_form(
    token: str,
    body: RegistrationSubmitRequest,
    db: AsyncSession = Depends(get_db),
):
    form = (await db.execute(
        select(RegistrationForm).where(RegistrationForm.token == token)
    )).scalar_one_or_none()
    if not form:
        raise HTTPException(404, "Form không tồn tại")
    if not form.is_active:
        raise HTTPException(410, "Form đã đóng, không thể đăng ký")

    workshops = await _form_workshops(db, form)
    allowed_ids = {w.id for w in workshops}
    if body.workshop_id not in allowed_ids:
        raise HTTPException(400, "Workshop không thuộc form đăng ký này")
    workshop = next(w for w in workshops if w.id == body.workshop_id)

    # Validation
    full_name = (body.full_name or "").strip()
    if not full_name:
        raise HTTPException(400, "Vui lòng nhập họ và tên")
    if not _PHONE_RE.match((body.phone or "").strip()):
        raise HTTPException(400, "Số điện thoại không hợp lệ")
    phone = _normalize_phone(body.phone)
    if len(phone) < 9 or len(phone) > 11:
        raise HTTPException(400, "Số điện thoại không hợp lệ")
    if body.party_size is None or body.party_size < 1:
        raise HTTPException(400, "Số khách đăng ký phải lớn hơn hoặc bằng 1")

    party_size = int(body.party_size)
    business_model = (body.business_model or "").strip() or None

    # Tạo guest (giống flow admin thêm khách)
    guest = Guest(
        workshop_id=workshop.id,
        full_name=full_name,
        phone=phone,
        business_model=business_model,
        party_size=party_size,
        checkin_status="not_checked_in",
        registered_at=_now(),
        local_updated_at=_now(),
        sync_status="pending_push",
    )
    db.add(guest)
    await db.commit()
    await db.refresh(guest)

    # Auto push lên Lark (best-effort, không chặn đăng ký)
    lark_synced = False
    try:
        from .lark_sync import _push_guest_to_lark
        await _push_guest_to_lark(db, guest)
        lark_synced = True
    except Exception as e:
        logger.warning("auto push registration guest to lark failed for %s: %s", guest.id, e)

    guest = await db.get(Guest, guest.id)

    submission = RegistrationSubmission(
        form_id=form.id,
        workshop_id=workshop.id,
        guest_id=guest.id,
        full_name=full_name,
        phone=phone,
        party_size=party_size,
        business_model=business_model,
        submitted_at=_now(),
    )
    db.add(submission)
    await db.commit()
    await db.refresh(submission)

    return RegistrationSubmitResult(
        guest=GuestOut.model_validate(guest),
        submission_id=submission.id,
        lark_synced=lark_synced,
    )
