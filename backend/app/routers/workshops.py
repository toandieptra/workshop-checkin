import logging
import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy import func, nulls_last, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..config import settings
from ..auth.workshop_access import WORKSHOP_PERMISSIONS, allowed_workshop_ids, is_global_workshop_admin, require_workshop_permission
from ..db import get_db
from ..models import (
    AdminUser,
    Guest,
    GuestNote,
    RegistrationForm,
    RegistrationFormWorkshop,
    RegistrationSubmission,
    Workshop,
    WorkshopLandingPage,
    WorkshopMedia,
    WorkshopMember,
)
from ..schemas import (
    GuestCreate,
    GuestOut,
    WorkshopCreate,
    WorkshopLandingContentOut,
    WorkshopLandingContentUpdate,
    WorkshopLandingPagePublic,
    WorkshopLandingPageUpdate,
    WorkshopLinkedFormOut,
    WorkshopMediaOut,
    WorkshopOut,
    WorkshopStatusUpdate,
    WorkshopUpdate,
    WORKSHOP_MEDIA_TYPES,
    WORKSHOP_STATUS_TRANSITIONS,
    WORKSHOP_STATUSES,
)
from ..auth.dependencies import current_user, require_permission
from ..services.guest_provenance import normalize_guest_source

logger = logging.getLogger("workshops")
VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")
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


def _validate_status_transition(current: str, target: str, *, allow_cancel: bool = False) -> None:
    _validate_status(current)
    _validate_status(target)
    if current == target:
        return
    if target == "cancelled" and not allow_cancel:
        raise HTTPException(403, "Cần quyền xóa workshop để hủy workshop")
    if target not in WORKSHOP_STATUS_TRANSITIONS[current]:
        raise HTTPException(409, f"Không thể chuyển trạng thái từ {current} sang {target}")


def _validate_branch(branch: str | None) -> None:
    if branch is None or branch == "":
        return
    allowed = _branch_list()
    if allowed and branch not in allowed:
        raise HTTPException(400, f"branch không hợp lệ. Chọn: {', '.join(allowed)}")


def _validate_media_type(media_type: str) -> None:
    if media_type not in WORKSHOP_MEDIA_TYPES:
        raise HTTPException(400, f"media_type phải là một trong: {', '.join(WORKSHOP_MEDIA_TYPES)}")


# ===== Landing page content helpers =====

LANDING_CONTENT_MAX_BYTES = 200_000
_LANDING_PLACEHOLDER_RE = re.compile(r"^\s*\[.*\]\s*$", re.S)


def _is_blank_or_placeholder(value: object) -> bool:
    if not isinstance(value, str):
        return True
    v = value.strip()
    return not v or bool(_LANDING_PLACEHOLDER_RE.match(v))


def _valid_landing_href(href: object) -> bool:
    if href is None or href == "":
        return True
    if not isinstance(href, str):
        return False
    h = href.strip()
    return h.startswith(("http://", "https://", "/", "#"))


def _validate_landing_content(content: dict) -> list[str]:
    """Trả về danh sách vấn đề chặn xuất bản (rỗng = hợp lệ)."""
    issues: list[str] = []
    hero = content.get("hero") or {}
    if _is_blank_or_placeholder(hero.get("displayTitle")):
        issues.append("Thiếu tiêu đề hiển thị (Hero)")
    if _is_blank_or_placeholder(hero.get("tagline")):
        issues.append("Thiếu tagline (Hero)")
    about = content.get("about") or {}
    if _is_blank_or_placeholder(about.get("description")):
        issues.append("Thiếu mô tả giới thiệu")
    program = content.get("program") or {}
    items = program.get("items") or []
    if not any(
        isinstance(it, dict) and not _is_blank_or_placeholder(it.get("title"))
        for it in items
    ):
        issues.append("Chương trình cần ít nhất 1 mục có tiêu đề")
    highlights = content.get("highlights") or {}
    cards = highlights.get("cards") or []
    if not any(
        isinstance(c, dict) and not _is_blank_or_placeholder(c.get("title"))
        for c in cards
    ):
        issues.append("Điểm nổi bật cần ít nhất 1 thẻ có tiêu đề")
    for label, href in (
        ("CTA Hero", hero.get("ctaHref")),
        ("CTA Điểm nổi bật", highlights.get("ctaHref")),
    ):
        if not _valid_landing_href(href):
            issues.append(f"{label} không hợp lệ (chỉ nhận http(s):// hoặc đường dẫn nội bộ)")
    return issues


async def _get_landing_page_row(db: AsyncSession, workshop_id: uuid.UUID) -> WorkshopLandingPage | None:
    return (await db.execute(
        select(WorkshopLandingPage).where(WorkshopLandingPage.workshop_id == workshop_id)
    )).scalar_one_or_none()


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


async def _linked_forms(db: AsyncSession, workshop_id: uuid.UUID, user=None) -> list[WorkshopLinkedFormOut]:
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
    if user is not None:
        from .registration_forms import _can_read_form
        accessible = await allowed_workshop_ids(db, user, "registration_forms.read")
    for form in rows:
        if user is not None and not await _can_read_form(db, user, form, accessible):
            continue
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


async def _linked_form(
    db: AsyncSession,
    workshop_id: uuid.UUID,
    form_id: uuid.UUID,
) -> RegistrationForm | None:
    form = await db.get(RegistrationForm, form_id)
    if not form:
        return None
    linked_workshop_ids = (await db.execute(
        select(RegistrationFormWorkshop.workshop_id).where(
            RegistrationFormWorkshop.form_id == form_id
        )
    )).scalars().all()
    if linked_workshop_ids:
        return form if workshop_id in linked_workshop_ids else None
    return form if form.workshop_id == workshop_id else None


async def _linked_form_out(db: AsyncSession, form: RegistrationForm) -> WorkshopLinkedFormOut:
    count = (await db.execute(
        select(func.count(RegistrationSubmission.id)).where(
            RegistrationSubmission.form_id == form.id
        )
    )).scalar_one()
    return WorkshopLinkedFormOut(
        id=form.id,
        token=form.token,
        greeting=form.greeting,
        is_active=form.is_active,
        submission_count=count,
        created_at=form.created_at,
    )


async def _to_out(db: AsyncSession, w: Workshop, include_forms: bool = True, user=None) -> WorkshopOut:
    media = list(w.media) if w.media is not None else []
    forms = await _linked_forms(db, w.id, user=user) if include_forms else []
    return WorkshopOut(
        id=w.id,
        name=w.name,
        slug=w.slug,
        event_date=w.event_date,
        event_time=w.event_time,
        location=w.location,
        status=w.status or "draft",
        auto_confirm_registration=w.auto_confirm_registration,
        branch=w.branch,
        maps_url=w.maps_url,
        registration_short_url=w.registration_short_url,
        zalo_group_url=w.zalo_group_url,
        landing_registration_form_id=w.landing_registration_form_id,
        created_at=w.created_at,
        updated_at=w.updated_at,
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
async def list_branches(user=Depends(current_user)):
    return {"branches": _branch_list()}


@router.get("/workshops", response_model=list[WorkshopOut])
async def list_workshops(
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    user=Depends(current_user),
    permission: str = "workshops.read",
):
    if permission not in WORKSHOP_PERMISSIONS:
        raise HTTPException(422, "Quyền bộ chọn workshop không hợp lệ")
    stmt = (
        select(Workshop)
        .options(selectinload(Workshop.media))
        .order_by(
            nulls_last(Workshop.event_date.desc()),
            Workshop.created_at.desc(),
        )
    )
    accessible = await allowed_workshop_ids(db, user, permission)
    if accessible is not None:
        stmt = stmt.where(Workshop.id.in_(accessible))
    if status:
        _validate_status(status)
        stmt = stmt.where(Workshop.status == status)
    rows = (await db.execute(stmt)).scalars().all()
    return [await _to_out(db, w, include_forms=permission == "workshops.read", user=user) for w in rows]


@router.post("/workshops", response_model=WorkshopOut, status_code=201, dependencies=[Depends(require_permission("workshops.write"))])
async def create_workshop(body: WorkshopCreate, db: AsyncSession = Depends(get_db), user=Depends(require_permission("workshops.write"))):
    slug = body.slug.strip() if body.slug else _slugify(body.name)
    if not slug:
        raise HTTPException(400, "slug không hợp lệ")
    exists = (await db.execute(select(Workshop).where(Workshop.slug == slug))).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "slug already exists")
    _validate_status(body.status)
    if body.status != "draft":
        raise HTTPException(409, "Workshop mới phải bắt đầu ở trạng thái draft")
    _validate_branch(body.branch)
    data = body.model_dump()
    data["slug"] = slug
    w = Workshop(**data)
    db.add(w)
    await db.flush()
    if not is_global_workshop_admin(user):
        db.add(WorkshopMember(user_id=user.id, workshop_id=w.id, role=user.role))
    await db.commit()
    w = await _get_workshop(db, w.id)
    return await _to_out(db, w, user=user)


@router.get("/workshops/{workshop_id}", response_model=WorkshopOut)
async def get_workshop(workshop_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    await require_workshop_permission(db, user, workshop_id, "workshops.read")
    w = await _get_workshop(db, workshop_id)
    return await _to_out(db, w, user=user)


@router.patch("/workshops/{workshop_id}", response_model=WorkshopOut)
async def update_workshop(
    workshop_id: uuid.UUID,
    body: WorkshopUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(current_user),
):
    await require_workshop_permission(db, user, workshop_id, "workshops.write")
    w = await _get_workshop(db, workshop_id)
    data = body.model_dump(exclude_unset=True)
    if "status" in data and data["status"] is not None:
        _validate_status_transition(w.status, data["status"])
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
    return await _to_out(db, w, user=user)


@router.patch("/workshops/{workshop_id}/status", response_model=WorkshopOut)
async def update_workshop_status(
    workshop_id: uuid.UUID,
    body: WorkshopStatusUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(current_user),
):
    await require_workshop_permission(db, user, workshop_id, "workshops.write")
    w = await _get_workshop(db, workshop_id)
    _validate_status_transition(w.status, body.status)
    w.status = body.status
    w.updated_at = datetime.now(timezone.utc)
    await db.commit()
    w = await _get_workshop(db, workshop_id)
    return await _to_out(db, w, user=user)


@router.patch(
    "/workshops/{workshop_id}/landing-page",
    response_model=WorkshopOut
)
async def update_workshop_landing_page(
    workshop_id: uuid.UUID,
    body: WorkshopLandingPageUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(current_user),
):
    await require_workshop_permission(db, user, workshop_id, "workshops.write")
    w = await _get_workshop(db, workshop_id)
    form = await _linked_form(db, workshop_id, body.registration_form_id)
    if not form:
        raise HTTPException(400, "Form đăng ký không thuộc workshop này")
    w.landing_registration_form_id = form.id
    w.updated_at = datetime.now(timezone.utc)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Form đăng ký không còn tồn tại")
    w = await _get_workshop(db, workshop_id)
    return await _to_out(db, w, user=user)


@router.get(
    "/workshops/{workshop_id}/landing-page/content",
    response_model=WorkshopLandingContentOut
)
async def get_workshop_landing_content(
    workshop_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user=Depends(current_user),
):
    await require_workshop_permission(db, user, workshop_id, "workshops.read")
    await _get_workshop(db, workshop_id)
    row = await _get_landing_page_row(db, workshop_id)
    if not row:
        return WorkshopLandingContentOut(workshop_id=workshop_id)
    return WorkshopLandingContentOut.model_validate(row)


@router.patch(
    "/workshops/{workshop_id}/landing-page/content",
    response_model=WorkshopLandingContentOut
)
async def save_workshop_landing_content(
    workshop_id: uuid.UUID,
    body: WorkshopLandingContentUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(current_user),
):
    await require_workshop_permission(db, user, workshop_id, "workshops.write")
    """Lưu bản nháp nội dung landing page. Không ảnh hưởng bản đã xuất bản."""
    await _get_workshop(db, workshop_id)
    if not isinstance(body.content, dict):
        raise HTTPException(400, "content phải là JSON object")
    if len(json.dumps(body.content, ensure_ascii=False)) > LANDING_CONTENT_MAX_BYTES:
        raise HTTPException(400, "Nội dung vượt quá dung lượng cho phép")
    row = await _get_landing_page_row(db, workshop_id)
    now = datetime.now(timezone.utc)
    if not row:
        row = WorkshopLandingPage(workshop_id=workshop_id, draft_content=body.content)
        db.add(row)
    else:
        row.draft_content = body.content
        row.updated_at = now
    await db.commit()
    await db.refresh(row)
    return WorkshopLandingContentOut.model_validate(row)


@router.post(
    "/workshops/{workshop_id}/landing-page/publish",
    response_model=WorkshopLandingContentOut
)
async def publish_workshop_landing_content(
    workshop_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user=Depends(current_user),
):
    await require_workshop_permission(db, user, workshop_id, "workshops.write")
    """Xuất bản bản nháp hiện tại thành nội dung công khai."""
    await _get_workshop(db, workshop_id)
    row = await _get_landing_page_row(db, workshop_id)
    if not row or not row.draft_content:
        raise HTTPException(400, "Chưa có nội dung nháp để xuất bản")
    issues = _validate_landing_content(row.draft_content)
    if issues:
        raise HTTPException(400, "Không thể xuất bản: " + "; ".join(issues))
    row.published_content = row.draft_content
    row.published_at = datetime.now(timezone.utc)
    row.updated_at = row.published_at
    await db.commit()
    await db.refresh(row)
    return WorkshopLandingContentOut.model_validate(row)


@router.delete("/workshops/{workshop_id}")
async def delete_workshop(
    workshop_id: uuid.UUID,
    hard: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    user=Depends(current_user),
):
    await require_workshop_permission(db, user, workshop_id, "workshops.delete")
    """hard=false (mặc định): soft-delete → cancelled.
    hard=true: xóa hẳn workshop + media files (cascade guests/forms links).
    """
    w = await _get_workshop(db, workshop_id)
    if hard:
        if w.status != "cancelled":
            raise HTTPException(409, "Chỉ có thể xóa vĩnh viễn workshop đã hủy")
        from .registration_forms import _require_form_permission
        primary_forms = (await db.execute(select(RegistrationForm).where(
            RegistrationForm.workshop_id == workshop_id
        ))).scalars().all()
        for form in primary_forms:
            await _require_form_permission(db, user, form, "workshops.delete")
        for m in w.media or []:
            _delete_media_file(m.file_url)
        await db.delete(w)
        await db.commit()
        return None
    _validate_status_transition(w.status, "cancelled", allow_cancel=True)
    w.status = "cancelled"
    w.updated_at = datetime.now(timezone.utc)
    await db.commit()
    w = await _get_workshop(db, workshop_id)
    return await _to_out(db, w, user=user)


@router.get("/workshops/{workshop_id}/registration-forms", response_model=list[WorkshopLinkedFormOut])
async def list_workshop_forms(workshop_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    await require_workshop_permission(db, user, workshop_id, "registration_forms.read")
    await _get_workshop(db, workshop_id)
    return await _linked_forms(db, workshop_id, user=user)


@router.get(
    "/public/workshops/by-slug/{slug}/landing-page",
    response_model=WorkshopLandingPagePublic,
)
async def get_workshop_landing_page(slug: str, db: AsyncSession = Depends(get_db)):
    w = (await db.execute(
        select(Workshop)
        .options(selectinload(Workshop.media))
        .where(Workshop.slug == slug)
    )).scalar_one_or_none()
    if not w or not w.landing_registration_form_id:
        raise HTTPException(404, "Landing page không tồn tại")
    form = await _linked_form(db, w.id, w.landing_registration_form_id)
    if not form:
        raise HTTPException(404, "Form đăng ký của landing page không còn hợp lệ")
    landing_row = await _get_landing_page_row(db, w.id)
    return WorkshopLandingPagePublic(
        id=w.id,
        name=w.name,
        slug=w.slug,
        event_date=w.event_date,
        event_time=w.event_time,
        location=w.location,
        status=w.status or "draft",
        branch=w.branch,
        maps_url=w.maps_url,
        zalo_group_url=w.zalo_group_url,
        media=[WorkshopMediaOut.model_validate(m) for m in list(w.media or [])],
        registration_form=await _linked_form_out(db, form),
        landing_content=(landing_row.published_content if landing_row else None),
    )


@router.post("/workshops/{workshop_id}/media", response_model=list[WorkshopMediaOut], status_code=201)
async def upload_workshop_media(
    workshop_id: uuid.UUID,
    media_type: str = Form("banner"),
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    user=Depends(current_user),
):
    await require_workshop_permission(db, user, workshop_id, "workshops.write")
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
    return result


@router.delete("/workshops/{workshop_id}/media/{media_id}", status_code=204)
async def delete_workshop_media(
    workshop_id: uuid.UUID,
    media_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user=Depends(current_user),
):
    await require_workshop_permission(db, user, workshop_id, "workshops.write")
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


@router.patch("/workshops/{workshop_id}/media/reorder", response_model=list[WorkshopMediaOut])
async def reorder_workshop_media(
    workshop_id: uuid.UUID,
    body: list[uuid.UUID],
    db: AsyncSession = Depends(get_db),
    user=Depends(current_user),
):
    await require_workshop_permission(db, user, workshop_id, "workshops.write")
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


@router.get("/workshops/{workshop_id}/guests", response_model=list[GuestOut])
async def list_guests(
    workshop_id: uuid.UUID,
    search: str | None = None,
    sort_registered_at: str = Query("desc", pattern="^(asc|desc)$"),
    db: AsyncSession = Depends(get_db),
    user=Depends(current_user),
    permission: str = "guests.read",
):
    if permission not in {"guests.read", "reports.read"}:
        raise HTTPException(422, "Quyền đọc dữ liệu khách không hợp lệ")
    await require_workshop_permission(db, user, workshop_id, permission)
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
    if not rows:
        return []

    guest_ids = [g.id for g in rows]
    note_rows = (await db.execute(
        select(GuestNote.guest_id, GuestNote.content, GuestNote.created_at, AdminUser.name)
        .outerjoin(AdminUser, AdminUser.id == GuestNote.author_user_id)
        .where(GuestNote.guest_id.in_(guest_ids))
        .order_by(GuestNote.created_at.desc(), GuestNote.id.desc())
    )).all()
    notes_by_guest: dict[uuid.UUID, list[str]] = {}
    for guest_id, content, created_at, author_name in note_rows:
        author = (author_name or "—").strip() or "—"
        if created_at is not None:
            local_dt = created_at.astimezone(VN_TZ) if created_at.tzinfo else created_at.replace(tzinfo=VN_TZ)
            time_str = f"{local_dt.strftime('%H:%M:%S')} {local_dt.day}/{local_dt.month}/{local_dt.year}"
        else:
            time_str = "—"
        line = f"{author} · {time_str}: {content}"
        notes_by_guest.setdefault(guest_id, []).append(line)

    result: list[GuestOut] = []
    for g in rows:
        out = GuestOut.model_validate(g)
        notes = notes_by_guest.get(g.id)
        if notes:
            out = out.model_copy(update={"notes_summary": "\n".join(notes)})
        result.append(out)
    return result


@router.post("/workshops/{workshop_id}/guests", response_model=GuestOut, status_code=201)
async def create_guest(
    workshop_id: uuid.UUID,
    body: GuestCreate,
    user: AdminUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    # Check-in guest accounts hold the narrow guests.create grant: they may add
    # walk-in attendees but never edit, confirm or import.
    await require_workshop_permission(db, user, workshop_id, "guests.write", "guests.create", any_of=True)
    w = await db.get(Workshop, workshop_id)
    if not w:
        raise HTTPException(404, "workshop not found")
    values = body.model_dump()
    values["source"], values["source_detail"] = normalize_guest_source(
        values.get("source"), values.get("source_detail")
    )
    values["creator_user_id"] = user.id
    values["creator_name"] = user.name or user.username or user.email
    from ..services.registration_confirmation import apply_registration_policy
    from ..services.zbs import normalize_phone
    values["phone"] = normalize_phone(values.get("phone")) or None
    if values["phone"]:
        existing = (await db.execute(
            select(Guest).where(
                Guest.workshop_id == workshop_id,
                Guest.deleted_at.is_(None),
                func.regexp_replace(func.coalesce(Guest.phone, ""), r"\D", "", "g") == values["phone"],
            )
        )).scalars().first()
        if existing:
            return JSONResponse(
                status_code=409,
                content={
                    "detail": f"Số điện thoại này đã đăng ký tham gia {w.name}",
                    "existing_guest": {
                        "id": str(existing.id),
                        "full_name": existing.full_name,
                        "phone": existing.phone,
                        "business_model": existing.business_model,
                        "party_size": existing.party_size,
                        "guest_type": existing.guest_type,
                    },
                },
            )
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
    from ..services.zalo_messages import enqueue_auto_send_new_guest
    await enqueue_auto_send_new_guest(db, g)
    await db.commit()
    await db.refresh(g)
    return g
