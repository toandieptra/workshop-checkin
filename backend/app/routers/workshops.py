import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import func, nulls_last, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..config import settings
from ..db import get_db
from ..models import (
    AdminUser,
    Guest,
    RegistrationForm,
    RegistrationFormWorkshop,
    RegistrationSubmission,
    Workshop,
    WorkshopMedia,
)
from ..schemas import (
    GuestCreate,
    GuestOut,
    WorkshopCreate,
    WorkshopLinkedFormOut,
    WorkshopMediaOut,
    WorkshopOut,
    WorkshopStatusUpdate,
    WorkshopUpdate,
    WORKSHOP_MEDIA_TYPES,
    WORKSHOP_STATUSES,
)
from ..auth.dependencies import require_permission
from ..services.guest_provenance import normalize_guest_source

logger = logging.getLogger("workshops")
router = APIRouter(prefix="/api", tags=["workshops"])

ALLOWED_MIMES = {
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
ALLOWED_EXTS = {"jpg", "jpeg", "png", "webp", "heic", "heif", "pdf", "doc", "docx"}


def _search_tokens(search: str | None) -> list[str]:
    if not search:
        return []
    return [t.lower() for t in re.findall(r"[\w\d]+", search.strip(), flags=re.UNICODE) if t.strip()]


def _slugify(name: str) -> str:
    s = name.strip().lower()
    s = re.sub(r"[àáạảãâầấậẩẫăằắặẳẵ]", "a", s)
    s = re.sub(r"[èéẹẻẽêềếệểễ]", "e", s)
    s = re.sub(r"[ìíịỉĩ]", "i", s)
    s = re.sub(r"[òóọỏõôồốộổỗơờớợởỡ]", "o", s)
    s = re.sub(r"[ùúụủũưừứựửữ]", "u", s)
    s = re.sub(r"[ỳýỵỷỹ]", "y", s)
    s = re.sub(r"[đ]", "d", s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "workshop"


def _branch_list() -> list[str]:
    return [b.strip() for b in (settings.WORKSHOP_BRANCHES or "").split(",") if b.strip()]


def _validate_status(status: str) -> None:
    if status not in WORKSHOP_STATUSES:
        raise HTTPException(400, f"status phải là một trong: {', '.join(WORKSHOP_STATUSES)}")


def _validate_branch(branch: str | None) -> None:
    if branch is None or branch == "":
        return
    allowed = _branch_list()
    if allowed and branch not in allowed:
        raise HTTPException(400, f"branch không hợp lệ. Chọn: {', '.join(allowed)}")


def _validate_media_type(media_type: str) -> None:
    if media_type not in WORKSHOP_MEDIA_TYPES:
        raise HTTPException(400, f"media_type phải là một trong: {', '.join(WORKSHOP_MEDIA_TYPES)}")


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


async def _linked_forms(db: AsyncSession, workshop_id: uuid.UUID) -> list[WorkshopLinkedFormOut]:
    rows = (await db.execute(
        select(RegistrationForm)
        .join(RegistrationFormWorkshop, RegistrationFormWorkshop.form_id == RegistrationForm.id)
        .where(RegistrationFormWorkshop.workshop_id == workshop_id)
        .order_by(RegistrationForm.created_at.desc())
    )).scalars().all()
    # form cũ chỉ có workshop_id, chưa có row M2M
    if not rows:
        rows = (await db.execute(
            select(RegistrationForm)
            .where(RegistrationForm.workshop_id == workshop_id)
            .order_by(RegistrationForm.created_at.desc())
        )).scalars().all()

    out: list[WorkshopLinkedFormOut] = []
    for form in rows:
        count = (await db.execute(
            select(func.count(RegistrationSubmission.id)).where(
                RegistrationSubmission.form_id == form.id
            )
        )).scalar_one()
        out.append(WorkshopLinkedFormOut(
            id=form.id,
            token=form.token,
            greeting=form.greeting,
            is_active=form.is_active,
            submission_count=count,
            created_at=form.created_at,
        ))
    return out


async def _to_out(db: AsyncSession, w: Workshop, include_forms: bool = True) -> WorkshopOut:
    media = list(w.media) if w.media is not None else []
    forms = await _linked_forms(db, w.id) if include_forms else []
    return WorkshopOut(
        id=w.id,
        name=w.name,
        slug=w.slug,
        event_date=w.event_date,
        event_time=w.event_time,
        location=w.location,
        status=w.status or "draft",
        branch=w.branch,
        maps_url=w.maps_url,
        registration_short_url=w.registration_short_url,
        lark_workshop_name=w.lark_workshop_name,
        lark_record_id=w.lark_record_id,
        created_at=w.created_at,
        updated_at=w.updated_at,
        last_synced_at=w.last_synced_at,
        media=[WorkshopMediaOut.model_validate(m) for m in media],
        registration_forms=forms,
    )


async def _get_workshop(db: AsyncSession, workshop_id: uuid.UUID) -> Workshop:
    w = (await db.execute(
        select(Workshop)
        .options(selectinload(Workshop.media))
        .where(Workshop.id == workshop_id)
    )).scalar_one_or_none()
    if not w:
        raise HTTPException(404, "not found")
    return w


@router.get("/workshops/meta/branches")
async def list_branches():
    return {"branches": _branch_list()}


@router.get("/workshops", response_model=list[WorkshopOut])
async def list_workshops(
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Workshop)
        .options(selectinload(Workshop.media))
        .order_by(
            nulls_last(Workshop.event_date.desc()),
            Workshop.created_at.desc(),
        )
    )
    if status:
        _validate_status(status)
        stmt = stmt.where(Workshop.status == status)
    rows = (await db.execute(stmt)).scalars().all()
    return [await _to_out(db, w, include_forms=True) for w in rows]


@router.post("/workshops", response_model=WorkshopOut, status_code=201, dependencies=[Depends(require_permission("workshops.write"))])
async def create_workshop(body: WorkshopCreate, db: AsyncSession = Depends(get_db)):
    slug = body.slug.strip() if body.slug else _slugify(body.name)
    if not slug:
        raise HTTPException(400, "slug không hợp lệ")
    exists = (await db.execute(select(Workshop).where(Workshop.slug == slug))).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "slug already exists")
    _validate_status(body.status)
    _validate_branch(body.branch)
    data = body.model_dump()
    data["slug"] = slug
    w = Workshop(**data)
    db.add(w)
    await db.commit()
    w = await _get_workshop(db, w.id)
    try:
        from .lark_sync import _push_workshop_to_lark
        await _push_workshop_to_lark(db, w)
    except Exception as e:
        logger.warning("auto push workshop to lark failed for %s: %s", w.id, e)
    w = await _get_workshop(db, w.id)
    return await _to_out(db, w)


@router.get("/workshops/{workshop_id}", response_model=WorkshopOut)
async def get_workshop(workshop_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    w = await _get_workshop(db, workshop_id)
    return await _to_out(db, w)


@router.patch("/workshops/{workshop_id}", response_model=WorkshopOut, dependencies=[Depends(require_permission("workshops.write"))])
async def update_workshop(
    workshop_id: uuid.UUID,
    body: WorkshopUpdate,
    db: AsyncSession = Depends(get_db),
):
    w = await _get_workshop(db, workshop_id)
    data = body.model_dump(exclude_unset=True)
    if "status" in data and data["status"] is not None:
        _validate_status(data["status"])
    if "branch" in data:
        _validate_branch(data["branch"])
    if "slug" in data and data["slug"] is not None:
        slug = data["slug"].strip()
        if not slug:
            raise HTTPException(400, "slug không hợp lệ")
        other = (await db.execute(
            select(Workshop).where(Workshop.slug == slug, Workshop.id != workshop_id)
        )).scalar_one_or_none()
        if other:
            raise HTTPException(409, "slug already exists")
        data["slug"] = slug
    for k, v in data.items():
        setattr(w, k, v)
    w.updated_at = datetime.now(timezone.utc)
    await db.commit()
    w = await _get_workshop(db, workshop_id)
    try:
        from .lark_sync import _push_workshop_to_lark
        await _push_workshop_to_lark(db, w)
    except Exception as e:
        logger.warning("auto push workshop (update) to lark failed for %s: %s", w.id, e)
    w = await _get_workshop(db, workshop_id)
    return await _to_out(db, w)


@router.patch("/workshops/{workshop_id}/status", response_model=WorkshopOut, dependencies=[Depends(require_permission("workshops.write"))])
async def update_workshop_status(
    workshop_id: uuid.UUID,
    body: WorkshopStatusUpdate,
    db: AsyncSession = Depends(get_db),
):
    _validate_status(body.status)
    w = await _get_workshop(db, workshop_id)
    w.status = body.status
    w.updated_at = datetime.now(timezone.utc)
    await db.commit()
    w = await _get_workshop(db, workshop_id)
    return await _to_out(db, w)


@router.delete("/workshops/{workshop_id}", dependencies=[Depends(require_permission("workshops.delete"))])
async def delete_workshop(
    workshop_id: uuid.UUID,
    hard: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    """hard=false (mặc định): soft-delete → cancelled.
    hard=true: xóa hẳn workshop + media files (cascade guests/forms links).
    """
    w = await _get_workshop(db, workshop_id)
    if hard:
        for m in w.media or []:
            _delete_media_file(m.file_url)
        await db.delete(w)
        await db.commit()
        return None
    w.status = "cancelled"
    w.updated_at = datetime.now(timezone.utc)
    await db.commit()
    w = await _get_workshop(db, workshop_id)
    return await _to_out(db, w)


@router.get("/workshops/{workshop_id}/registration-forms", response_model=list[WorkshopLinkedFormOut], dependencies=[Depends(require_permission("registration_forms.read"))])
async def list_workshop_forms(workshop_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    await _get_workshop(db, workshop_id)
    return await _linked_forms(db, workshop_id)


@router.post("/workshops/{workshop_id}/media", response_model=list[WorkshopMediaOut], status_code=201, dependencies=[Depends(require_permission("workshops.write"))])
async def upload_workshop_media(
    workshop_id: uuid.UUID,
    media_type: str = Form("banner"),
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    _validate_media_type(media_type)
    w = await _get_workshop(db, workshop_id)
    max_order = (await db.execute(
        select(func.coalesce(func.max(WorkshopMedia.sort_order), -1)).where(
            WorkshopMedia.workshop_id == workshop_id
        )
    )).scalar_one()
    created: list[WorkshopMedia] = []
    target_dir = Path(settings.UPLOAD_DIR) / "workshops" / str(workshop_id)
    target_dir.mkdir(parents=True, exist_ok=True)

    for f in files:
        mime = (f.content_type or "").lower()
        ext = os.path.splitext(f.filename or "")[1].lstrip(".").lower()
        if mime not in ALLOWED_MIMES and ext not in ALLOWED_EXTS:
            raise HTTPException(400, f"{f.filename}: định dạng không được hỗ trợ")
        data = await f.read()
        if len(data) == 0:
            raise HTTPException(400, f"{f.filename}: file rỗng")
        if len(data) > settings.MAX_UPLOAD_FILE_BYTES:
            raise HTTPException(400, f"{f.filename}: vượt quá dung lượng cho phép")
        out_ext = ext if ext in ALLOWED_EXTS else "bin"
        fname = f"{uuid.uuid4().hex}.{out_ext}"
        (target_dir / fname).write_bytes(data)
        max_order += 1
        m = WorkshopMedia(
            workshop_id=workshop_id,
            media_type=media_type,
            file_url=f"/uploads/workshops/{workshop_id}/{fname}",
            file_name=f.filename or fname,
            mime_type=mime or None,
            file_size=len(data),
            sort_order=max_order,
        )
        db.add(m)
        created.append(m)

    w.updated_at = datetime.now(timezone.utc)
    await db.commit()
    for m in created:
        await db.refresh(m)
    result = [WorkshopMediaOut.model_validate(m) for m in created]
    try:
        from .lark_sync import _push_workshop_to_lark
        w = await _get_workshop(db, workshop_id)
        await _push_workshop_to_lark(db, w)
    except Exception as e:
        logger.warning("auto push workshop media to lark failed for %s: %s", workshop_id, e)
    return result


@router.delete("/workshops/{workshop_id}/media/{media_id}", status_code=204, dependencies=[Depends(require_permission("workshops.write"))])
async def delete_workshop_media(
    workshop_id: uuid.UUID,
    media_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    m = (await db.execute(
        select(WorkshopMedia).where(
            WorkshopMedia.id == media_id,
            WorkshopMedia.workshop_id == workshop_id,
        )
    )).scalar_one_or_none()
    if not m:
        raise HTTPException(404, "media not found")
    _delete_media_file(m.file_url)
    await db.delete(m)
    w = await db.get(Workshop, workshop_id)
    if w:
        w.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return None


@router.patch("/workshops/{workshop_id}/media/reorder", response_model=list[WorkshopMediaOut], dependencies=[Depends(require_permission("workshops.write"))])
async def reorder_workshop_media(
    workshop_id: uuid.UUID,
    body: list[uuid.UUID],
    db: AsyncSession = Depends(get_db),
):
    await _get_workshop(db, workshop_id)
    rows = (await db.execute(
        select(WorkshopMedia).where(WorkshopMedia.workshop_id == workshop_id)
    )).scalars().all()
    by_id = {m.id: m for m in rows}
    for i, mid in enumerate(body):
        if mid not in by_id:
            raise HTTPException(400, f"media {mid} không thuộc workshop")
        by_id[mid].sort_order = i
    await db.commit()
    w = await _get_workshop(db, workshop_id)
    return [WorkshopMediaOut.model_validate(m) for m in w.media]


def _delete_media_file(file_url: str | None) -> None:
    if not file_url or not file_url.startswith("/uploads/"):
        return
    rel = file_url[len("/uploads/"):]
    path = Path(settings.UPLOAD_DIR) / rel
    try:
        if path.is_file():
            path.unlink()
    except OSError as e:
        logger.warning("cannot delete media file %s: %s", path, e)


@router.get("/workshops/{workshop_id}/guests", response_model=list[GuestOut], dependencies=[Depends(require_permission("guests.read"))])
async def list_guests(
    workshop_id: uuid.UUID,
    search: str | None = None,
    sort_registered_at: str = Query("desc", pattern="^(asc|desc)$"),
    db: AsyncSession = Depends(get_db),
):
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
async def create_guest(
    workshop_id: uuid.UUID,
    body: GuestCreate,
    user: AdminUser = Depends(require_permission("guests.write")),
    db: AsyncSession = Depends(get_db),
):
    w = await db.get(Workshop, workshop_id)
    if not w:
        raise HTTPException(404, "workshop not found")
    values = body.model_dump()
    values["source"], values["source_detail"] = normalize_guest_source(
        values.get("source"), values.get("source_detail")
    )
    values["creator_user_id"] = user.id
    values["creator_name"] = user.name or user.email
    from ..services.registration_confirmation import apply_registration_policy
    from ..services.zbs import normalize_phone
    values["phone"] = normalize_phone(values.get("phone")) or None
    g = Guest(workshop_id=workshop_id, registered_at=datetime.now(timezone.utc), **values)
    g.registration_status = "pending"
    db.add(g)
    await db.flush()
    await apply_registration_policy(
        db,
        g,
        auto_confirm=w.auto_confirm_registration,
        confirmed_by=user.id,
    )
    await db.commit()
    await db.refresh(g)
    try:
        from .lark_sync import _push_guest_to_lark
        await _push_guest_to_lark(db, g)
    except Exception as e:
        logger.warning("auto push guest to lark failed for %s: %s", g.id, e)
    g = await db.get(Guest, g.id)
    return g
