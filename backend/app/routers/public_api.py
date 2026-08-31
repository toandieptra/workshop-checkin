import math
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, nulls_last, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth.public_api import (
    ApiKeyPrincipal,
    IdempotencyKey,
    load_idempotent_response,
    require_api_scope,
    save_idempotent_response,
)
from ..db import engine, get_db
from ..models import CheckinLog, Guest, Workshop
from ..schemas import (
    CheckinLogOut,
    GuestSelfCheckinRequest,
    RegistrationFormPublic,
    RegistrationSubmitRequest,
    GuestQrInfo,
    WorkshopLandingPagePublic,
    WorkshopMediaOut,
)
from ..schemas_public import (
    Envelope,
    PaginationMeta,
    PublicCheckinRequest,
    PublicCheckinResult,
    PublicGuest,
    PublicGuestLookup,
    PublicHealth,
    PublicRegistrationResult,
    PublicSelfRegisterRequest,
    PublicSelfRegisterResult,
    PublicWorkshop,
)
from .guests import get_guest_qr_info, normalize_phone, self_checkin_guest, self_register_and_checkin
from .registration_forms import get_public_registration_form, submit_registration_form
from .workshops import get_workshop_landing_page


router = APIRouter(prefix="/api/public/v1", tags=["Public API v1"])


def _workshop_out(workshop: Workshop) -> PublicWorkshop:
    return PublicWorkshop(
        id=workshop.id,
        name=workshop.name,
        slug=workshop.slug,
        event_date=workshop.event_date,
        event_time=workshop.event_time,
        location=workshop.location,
        status=workshop.status,
        branch=workshop.branch,
        maps_url=workshop.maps_url,
        registration_short_url=workshop.registration_short_url,
        zalo_group_url=workshop.zalo_group_url,
        auto_confirm_registration=workshop.auto_confirm_registration,
        media=[WorkshopMediaOut.model_validate(item) for item in list(workshop.media or [])],
    )


def _guest_out(guest: Guest) -> PublicGuest:
    return PublicGuest(
        id=guest.id,
        workshop_id=guest.workshop_id,
        full_name=guest.full_name,
        phone=guest.phone,
        email=guest.email,
        company=guest.company,
        business_model=guest.business_model,
        role_title=guest.role_title,
        guest_type=guest.guest_type,
        party_size=guest.party_size or 1,
        registration_status=guest.registration_status,
        actual_party_size=guest.actual_party_size,
        checkin_status=guest.checkin_status,
        checked_in_at=guest.checked_in_at,
        registered_at=guest.registered_at,
    )


def _meta(page: int, per_page: int, total: int) -> PaginationMeta:
    return PaginationMeta(
        page=page,
        per_page=per_page,
        total=total,
        total_pages=math.ceil(total / per_page) if total else 0,
    )


@router.get("/health", response_model=Envelope[PublicHealth])
async def public_health():
    try:
        async with engine.connect() as conn:
            await conn.execute(select(1))
        db_ok = True
    except Exception:
        db_ok = False
    return Envelope(data=PublicHealth(status="ok" if db_ok else "degraded", db=db_ok))


@router.get("/workshops", response_model=Envelope[list[PublicWorkshop]])
async def list_public_workshops(
    _: Annotated[ApiKeyPrincipal, Depends(require_api_scope("workshops.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
    page: Annotated[int, Query(ge=1)] = 1,
    per_page: Annotated[int, Query(ge=1, le=100)] = 20,
    status: Annotated[str | None, Query(pattern="^(draft|published|completed|cancelled)$")] = None,
    branch: str | None = None,
    search: Annotated[str | None, Query(max_length=200)] = None,
    sort: Annotated[str, Query(pattern="^(event_date|created_at):(asc|desc)$")] = "event_date:desc",
):
    filters = []
    if status:
        filters.append(Workshop.status == status)
    if branch:
        filters.append(Workshop.branch == branch)
    if search:
        filters.append(or_(Workshop.name.ilike(f"%{search}%"), Workshop.slug.ilike(f"%{search}%")))
    total = (await db.execute(select(func.count()).select_from(Workshop).where(*filters))).scalar_one()
    sort_field, direction = sort.split(":")
    column = Workshop.event_date if sort_field == "event_date" else Workshop.created_at
    order = column.asc() if direction == "asc" else column.desc()
    rows = (await db.execute(
        select(Workshop)
        .options(selectinload(Workshop.media))
        .where(*filters)
        .order_by(nulls_last(order), Workshop.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )).scalars().all()
    return Envelope(data=[_workshop_out(row) for row in rows], meta=_meta(page, per_page, total))


@router.get("/workshops/{identifier}", response_model=Envelope[PublicWorkshop])
async def get_public_workshop(
    identifier: str,
    _: Annotated[ApiKeyPrincipal, Depends(require_api_scope("workshops.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    try:
        workshop_id = uuid.UUID(identifier)
        condition = Workshop.id == workshop_id
    except ValueError:
        condition = Workshop.slug == identifier
    workshop = (await db.execute(
        select(Workshop).options(selectinload(Workshop.media)).where(condition)
    )).scalar_one_or_none()
    if not workshop:
        raise HTTPException(404, "workshop not found")
    return Envelope(data=_workshop_out(workshop))


@router.get("/workshops/{workshop_id}/guests", response_model=Envelope[list[PublicGuest]])
async def list_public_guests(
    workshop_id: uuid.UUID,
    _: Annotated[ApiKeyPrincipal, Depends(require_api_scope("guests.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
    page: Annotated[int, Query(ge=1)] = 1,
    per_page: Annotated[int, Query(ge=1, le=100)] = 20,
    search: Annotated[str | None, Query(max_length=200)] = None,
    checkin_status: Annotated[str | None, Query(pattern="^(checked_in|not_checked_in)$")] = None,
):
    filters = [Guest.workshop_id == workshop_id, Guest.deleted_at.is_(None)]
    if search:
        pattern = f"%{search}%"
        filters.append(or_(Guest.full_name.ilike(pattern), Guest.phone.ilike(pattern), Guest.company.ilike(pattern)))
    if checkin_status:
        filters.append(Guest.checkin_status == checkin_status)
    total = (await db.execute(select(func.count()).select_from(Guest).where(*filters))).scalar_one()
    rows = (await db.execute(
        select(Guest).where(*filters)
        .order_by(func.coalesce(Guest.registered_at, Guest.created_at).desc(), Guest.full_name.asc())
        .offset((page - 1) * per_page).limit(per_page)
    )).scalars().all()
    return Envelope(data=[_guest_out(row) for row in rows], meta=_meta(page, per_page, total))


@router.get("/workshops/{slug}/landing", response_model=Envelope[WorkshopLandingPagePublic])
async def get_public_workshop_landing(
    slug: str,
    _: Annotated[ApiKeyPrincipal, Depends(require_api_scope("workshops.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return Envelope(data=await get_workshop_landing_page(slug, db))


@router.get("/guests/lookup", response_model=Envelope[PublicGuestLookup])
async def lookup_public_guest(
    _: Annotated[ApiKeyPrincipal, Depends(require_api_scope("guests.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
    phone: Annotated[str, Query(min_length=3, max_length=20)],
    workshop_slug: Annotated[str, Query(min_length=1, max_length=200)],
):
    normalized = normalize_phone(phone)
    if len(normalized) < 9 or len(normalized) > 11:
        raise HTTPException(400, "invalid phone number")
    workshop = (await db.execute(select(Workshop).where(Workshop.slug == workshop_slug))).scalar_one_or_none()
    if not workshop:
        raise HTTPException(404, "workshop not found")
    guest = (await db.execute(
        select(Guest).where(
            Guest.workshop_id == workshop.id,
            Guest.deleted_at.is_(None),
            func.regexp_replace(func.coalesce(Guest.phone, ""), r"\D", "", "g") == normalized,
        ).order_by(Guest.created_at.desc()).limit(1)
    )).scalar_one_or_none()
    result = PublicGuestLookup(
        found=guest is not None,
        reason="ok" if guest else "not_in_workshop",
        workshop_name=workshop.name,
        guest=_guest_out(guest) if guest else None,
    )
    return Envelope(data=result)


@router.get("/guests/{guest_id}", response_model=Envelope[PublicGuest])
async def get_public_guest(
    guest_id: uuid.UUID,
    _: Annotated[ApiKeyPrincipal, Depends(require_api_scope("guests.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    guest = (await db.execute(
        select(Guest).where(Guest.id == guest_id, Guest.deleted_at.is_(None))
    )).scalar_one_or_none()
    if not guest:
        raise HTTPException(404, "guest not found")
    return Envelope(data=_guest_out(guest))


@router.get("/guests/{guest_id}/qr", response_model=Envelope[GuestQrInfo])
async def get_public_guest_qr(
    guest_id: uuid.UUID,
    _: Annotated[ApiKeyPrincipal, Depends(require_api_scope("checkin.manage"))],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return Envelope(data=await get_guest_qr_info(guest_id, db))


@router.post("/checkins", response_model=Envelope[PublicCheckinResult])
async def create_public_checkin(
    body: PublicCheckinRequest,
    request: Request,
    principal: Annotated[ApiKeyPrincipal, Depends(require_api_scope("checkin.manage"))],
    db: Annotated[AsyncSession, Depends(get_db)],
    idempotency_key: IdempotencyKey = None,
):
    route = str(request.url.path)
    cached = await load_idempotent_response(principal, route, idempotency_key)
    if cached:
        return cached
    result = await self_checkin_guest(
        body.guest_id,
        GuestSelfCheckinRequest(**body.model_dump(include={"workshop_slug", "phone", "actual_party_size"})),
        db,
    )
    payload = Envelope(data=PublicCheckinResult(guest=_guest_out(result.guest))).model_dump(mode="json")
    await save_idempotent_response(principal, route, idempotency_key, payload)
    return payload


@router.post("/workshops/{workshop_id}/guests/self-register", response_model=Envelope[PublicSelfRegisterResult], status_code=201)
async def create_public_self_registration(
    workshop_id: uuid.UUID,
    body: PublicSelfRegisterRequest,
    request: Request,
    principal: Annotated[ApiKeyPrincipal, Depends(require_api_scope("guests.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
    idempotency_key: IdempotencyKey = None,
):
    route = str(request.url.path)
    cached = await load_idempotent_response(principal, route, idempotency_key)
    if cached:
        return cached
    workshop = await db.get(Workshop, workshop_id)
    if not workshop or workshop.slug != body.workshop_slug:
        raise HTTPException(404, "workshop not found")
    result = await self_register_and_checkin(body, db)
    payload = Envelope(data=PublicSelfRegisterResult(
        guest=_guest_out(result.guest), warning=result.warning
    )).model_dump(mode="json")
    await save_idempotent_response(principal, route, idempotency_key, payload)
    return payload


@router.get("/registration-forms/{token}", response_model=Envelope[RegistrationFormPublic])
async def get_public_form_v1(
    token: str,
    _: Annotated[ApiKeyPrincipal, Depends(require_api_scope("registration_forms.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return Envelope(data=await get_public_registration_form(token, db))


@router.post("/registration-forms/{token}/submissions", response_model=Envelope[PublicRegistrationResult], status_code=201)
async def create_public_form_submission(
    token: str,
    body: RegistrationSubmitRequest,
    request: Request,
    principal: Annotated[ApiKeyPrincipal, Depends(require_api_scope("registration_forms.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
    idempotency_key: IdempotencyKey = None,
):
    route = str(request.url.path)
    cached = await load_idempotent_response(principal, route, idempotency_key)
    if cached:
        return cached
    result = await submit_registration_form(token, body, request, db)
    payload = Envelope(data=PublicRegistrationResult(
        guest=_guest_out(result.guest),
        submission_id=result.submission_id,
        registration_status=result.registration_status,
    )).model_dump(mode="json")
    await save_idempotent_response(principal, route, idempotency_key, payload)
    return payload


@router.get("/checkins/logs", response_model=Envelope[list[CheckinLogOut]])
async def list_public_checkin_logs(
    _: Annotated[ApiKeyPrincipal, Depends(require_api_scope("checkin.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
    workshop_id: uuid.UUID,
    page: Annotated[int, Query(ge=1)] = 1,
    per_page: Annotated[int, Query(ge=1, le=100)] = 20,
):
    condition = CheckinLog.workshop_id == workshop_id
    total = (await db.execute(select(func.count()).select_from(CheckinLog).where(condition))).scalar_one()
    rows = (await db.execute(
        select(CheckinLog).where(condition).order_by(CheckinLog.created_at.desc())
        .offset((page - 1) * per_page).limit(per_page)
    )).scalars().all()
    data = [CheckinLogOut(
        id=row.id, guest_id=row.guest_id, method=row.method or "admin", status=row.status,
        checked_in_at=row.checked_in_at, checked_in_by=row.checked_in_by,
        note=row.note, created_at=row.created_at,
    ) for row in rows]
    return Envelope(data=data, meta=_meta(page, per_page, total))
