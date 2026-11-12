"""Quản trị survey theo workshop: cấu hình, cấu trúc nhóm/món, xuất bản, quà tặng, kết quả."""
import io
import uuid
from collections import Counter
from datetime import datetime
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from pydantic import BaseModel, Field
from sqlalchemy import Text, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import current_user
from ..auth.workshop_access import require_workshop_permission, workshop_permissions
from ..db import get_db
from ..models import (
    AdminUser, CatalogProduct, CatalogRecipe, GiftAuditLog, GiftClaim, GiftConfig, Survey, SurveyGroup, SurveyItem,
    SurveyResponse, SurveyResponseItem, SurveySession, SurveyVersion, Workshop,
)
from ..services import surveys as svc
from ..services.catalog_images import delete_stored, store_image
from ..services.gifts import effective_status
from ..services.survey_text import mask_phone, slugify

router = APIRouter(prefix="/api/workshops/{workshop_id}", tags=["surveys"])


# ---------------------------------------------------------------- schemas
class SurveyIn(BaseModel):
    slug: str | None = Field(default=None, max_length=80)
    title: str | None = Field(default=None, max_length=200)
    opens_at: datetime | None = None
    closes_at: datetime | None = None
    content: dict | None = None
    settings: dict | None = None


class StructureGroup(BaseModel):
    id: uuid.UUID | None = None
    key: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=120)
    short_title: str | None = Field(default=None, max_length=60)
    tint: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    parent_key: str | None = None


class StructureItem(BaseModel):
    id: uuid.UUID | None = None
    item_type: Literal["product", "recipe"]
    source_id: uuid.UUID
    group_key: str | None = None
    display_name: str | None = Field(default=None, max_length=200)


class StructureIn(BaseModel):
    groups: list[StructureGroup] = Field(default_factory=list, max_length=200)
    items: list[StructureItem] = Field(default_factory=list, max_length=2000)


class GiftConfigIn(BaseModel):
    enabled: bool = False
    gift_name: str = Field(default="", max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    instructions: str | None = Field(default=None, max_length=1000)
    eligibility: Literal["registered", "confirmed", "checked_in"] = "registered"
    redeem_until: datetime | None = None


class ResponsePatch(BaseModel):
    is_valid: bool


class RevokeIn(BaseModel):
    reason: str = Field(min_length=2, max_length=300)


# ---------------------------------------------------------------- helpers
async def _workshop(db: AsyncSession, workshop_id: uuid.UUID) -> Workshop:
    w = await db.get(Workshop, workshop_id)
    if w is None:
        raise HTTPException(404, "Workshop không tồn tại.")
    return w


async def _survey(db: AsyncSession, workshop_id: uuid.UUID, required: bool = True) -> Survey | None:
    s = (await db.execute(select(Survey).where(Survey.workshop_id == workshop_id))).scalar_one_or_none()
    if s is None and required:
        raise HTTPException(404, "Workshop chưa có khảo sát.")
    return s


async def _unique_slug(db: AsyncSession, base: str, exclude: uuid.UUID | None = None) -> str:
    base = slugify(base) or "khao-sat"
    if len(base) < 3:
        base = f"{base}-ks"
    candidate, n = base, 2
    while True:
        query = select(Survey.id).where(Survey.slug == candidate)
        if exclude:
            query = query.where(Survey.id != exclude)
        if await db.scalar(query) is None:
            return candidate
        candidate, n = f"{base[:74]}-{n}", n + 1


async def _structure_out(db: AsyncSession, survey: Survey) -> dict:
    groups = (await db.execute(
        select(SurveyGroup).where(SurveyGroup.survey_id == survey.id).order_by(SurveyGroup.sort_order)
    )).scalars().all()
    items = (await db.execute(
        select(SurveyItem).where(SurveyItem.survey_id == survey.id).order_by(SurveyItem.sort_order)
    )).scalars().all()
    pids = [i.product_id for i in items if i.product_id]
    rids = [i.recipe_id for i in items if i.recipe_id]
    names = {}
    for model, ids in ((CatalogProduct, pids), (CatalogRecipe, rids)):
        if ids:
            for row in (await db.execute(select(model).where(model.id.in_(ids)))).scalars():
                names[row.id] = row
    images = await svc.load_images(db, pids, rids)
    out_items = []
    for i in items:
        src_id = i.product_id or i.recipe_id
        src = names.get(src_id)
        pics = images.get((i.item_type, src_id), [])
        out_items.append({
            "id": str(i.id), "item_type": i.item_type, "source_id": str(src_id),
            "group_key": str(i.group_id) if i.group_id else None,
            "display_name": i.display_name, "catalog_name": src.name if src else "(đã xoá)",
            "catalog_status": src.status if src else "missing",
            "image_override_url": i.image_override_url,
            "thumb_url": i.image_override_url or (pics[0].thumb_url if pics else None), "image_count": len(pics),
        })
    return {
        "groups": [{
            "id": str(g.id), "key": str(g.id), "title": g.title, "short_title": g.short_title, "tint": g.tint,
            "parent_key": str(g.parent_id) if g.parent_id else None,
        } for g in groups],
        "items": out_items,
    }


async def _survey_out(db: AsyncSession, survey: Survey) -> dict:
    versions = (await db.execute(
        select(SurveyVersion.id, SurveyVersion.version_no, SurveyVersion.published_at)
        .where(SurveyVersion.survey_id == survey.id).order_by(SurveyVersion.version_no.desc())
    )).all()
    counts = dict((await db.execute(
        select(SurveySession.status, func.count()).where(SurveySession.survey_id == survey.id).group_by(SurveySession.status)
    )).all())
    current_snapshot_items = None
    if survey.current_version_id:
        version = await db.get(SurveyVersion, survey.current_version_id)
        current_snapshot_items = len(version.snapshot.get("items", [])) if version else None
    return {
        "id": str(survey.id), "workshop_id": str(survey.workshop_id), "slug": survey.slug, "title": survey.title,
        "status": survey.status, "public_state": svc.public_state(survey),
        "opens_at": survey.opens_at.isoformat() if survey.opens_at else None,
        "closes_at": survey.closes_at.isoformat() if survey.closes_at else None,
        "content": svc.merged_content(survey), "settings": svc.merged_settings(survey),
        "current_version_id": str(survey.current_version_id) if survey.current_version_id else None,
        "current_version_item_count": current_snapshot_items,
        "published_at": survey.published_at.isoformat() if survey.published_at else None,
        "updated_at": survey.updated_at.isoformat() if survey.updated_at else None,
        "versions": [{"id": str(v.id), "version_no": v.version_no, "published_at": v.published_at.isoformat()} for v in versions],
        "session_counts": {"draft": counts.get("draft", 0), "submitted": counts.get("submitted", 0)},
        "public_path": f"/survey/{survey.slug}",
        **(await _structure_out(db, survey)),
    }


def _gift_config_out(config: GiftConfig | None) -> dict:
    if config is None:
        return {"enabled": False, "gift_name": "", "description": None, "instructions": None,
                "eligibility": "registered", "redeem_until": None}
    return {
        "enabled": config.enabled, "gift_name": config.gift_name, "description": config.description,
        "instructions": config.instructions, "eligibility": config.eligibility,
        "redeem_until": config.redeem_until.isoformat() if config.redeem_until else None,
    }


# ---------------------------------------------------------------- config
@router.get("/survey")
async def get_survey(workshop_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    await require_workshop_permission(db, user, workshop_id, "surveys.read", "surveys.manage", any_of=True)
    workshop = await _workshop(db, workshop_id)
    survey = await _survey(db, workshop_id, required=False)
    gift = _gift_config_out(await db.get(GiftConfig, workshop_id))
    if survey is None:
        return {"survey": None, "gift_config": gift, "defaults": {
            "slug": await _unique_slug(db, workshop.slug or workshop.name), "title": workshop.name,
            "content": svc.DEFAULT_CONTENT, "settings": svc.default_settings(),
        }}
    return {"survey": await _survey_out(db, survey), "gift_config": gift}


@router.put("/survey")
async def save_survey(workshop_id: uuid.UUID, body: SurveyIn, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    await require_workshop_permission(db, user, workshop_id, "surveys.manage")
    workshop = await _workshop(db, workshop_id)
    survey = await _survey(db, workshop_id, required=False)
    if survey is None:
        survey = Survey(workshop_id=workshop_id, slug=await _unique_slug(db, body.slug or workshop.slug or workshop.name),
                        title=(body.title or workshop.name).strip(), status="draft",
                        content={}, settings=svc.default_settings())
        db.add(survey)
        await db.flush()
    if body.slug is not None:
        wanted = slugify(body.slug)
        if len(wanted) < 3:
            raise HTTPException(400, "Slug cần ít nhất 3 ký tự (a-z, 0-9, dấu gạch).")
        if wanted != survey.slug:
            if await db.scalar(select(Survey.id).where(Survey.slug == wanted, Survey.id != survey.id)):
                raise HTTPException(409, "Slug đã được khảo sát khác dùng.")
            if survey.status == "published":
                # QR đã in theo slug cũ; vẫn cho đổi nhưng phải xuất bản lại để snapshot khớp URL.
                survey.status = "draft"
            survey.slug = wanted
    if body.title is not None:
        if not body.title.strip():
            raise HTTPException(400, "Tiêu đề không được để trống.")
        survey.title = body.title.strip()
    if "opens_at" in body.model_fields_set:
        survey.opens_at = body.opens_at
    if "closes_at" in body.model_fields_set:
        survey.closes_at = body.closes_at
    if survey.opens_at and survey.closes_at and survey.opens_at >= survey.closes_at:
        raise HTTPException(400, "Giờ đóng phải sau giờ mở.")
    if body.content is not None:
        survey.content = {**(survey.content or {}), **svc.sanitize_content(body.content)}
    if body.settings is not None:
        survey.settings = svc.sanitize_settings(body.settings)
    survey.updated_at = svc.now_utc()
    await db.commit()
    await db.refresh(survey)
    return await _survey_out(db, survey)


@router.put("/survey/structure")
async def save_structure(workshop_id: uuid.UUID, body: StructureIn, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    """Thay toàn bộ cây nhóm + danh sách món theo thứ tự client gửi (giữ id cũ để kết quả liên tục)."""
    await require_workshop_permission(db, user, workshop_id, "surveys.manage")
    survey = await _survey(db, workshop_id)
    existing_groups = {g.id: g for g in (await db.execute(select(SurveyGroup).where(SurveyGroup.survey_id == survey.id))).scalars()}
    existing_items = {i.id: i for i in (await db.execute(select(SurveyItem).where(SurveyItem.survey_id == survey.id))).scalars()}

    keys = [g.key for g in body.groups]
    if len(keys) != len(set(keys)):
        raise HTTPException(400, "Khoá nhóm bị trùng.")
    by_key = {g.key: g for g in body.groups}
    for g in body.groups:
        if g.parent_key:
            parent = by_key.get(g.parent_key)
            if parent is None or parent.parent_key:
                raise HTTPException(400, f"Nhóm “{g.title}”: nhóm cha không hợp lệ (chỉ hỗ trợ 2 cấp).")

    # Kiểm tra nguồn catalog tồn tại.
    pids = {i.source_id for i in body.items if i.item_type == "product"}
    rids = {i.source_id for i in body.items if i.item_type == "recipe"}
    found_p = set((await db.execute(select(CatalogProduct.id).where(CatalogProduct.id.in_(pids or {uuid.UUID(int=0)})))).scalars())
    found_r = set((await db.execute(select(CatalogRecipe.id).where(CatalogRecipe.id.in_(rids or {uuid.UUID(int=0)})))).scalars())
    if pids - found_p or rids - found_r:
        raise HTTPException(400, "Có sản phẩm/công thức không còn trong danh mục.")
    seen_sources = set()
    for i in body.items:
        if (i.item_type, i.source_id) in seen_sources:
            raise HTTPException(400, "Một sản phẩm/công thức chỉ được xuất hiện một lần trong khảo sát.")
        seen_sources.add((i.item_type, i.source_id))

    # Nhóm: cập nhật / tạo mới; xoá nhóm không còn (món trong đó được gán lại bên dưới).
    key_to_id: dict[str, uuid.UUID] = {}
    kept_groups = set()
    ordered = [g for g in body.groups if not g.parent_key] + [g for g in body.groups if g.parent_key]
    sort_index = {g.key: idx for idx, g in enumerate(body.groups)}
    for g in ordered:
        row = existing_groups.get(g.id) if g.id else None
        if row is None:
            row = SurveyGroup(survey_id=survey.id, title=g.title.strip())
            db.add(row)
        row.title = g.title.strip()
        row.short_title = (g.short_title or "").strip() or None
        row.tint = g.tint
        row.sort_order = sort_index[g.key]
        row.parent_id = key_to_id.get(g.parent_key) if g.parent_key else None
        await db.flush()
        key_to_id[g.key] = row.id
        kept_groups.add(row.id)

    kept_items = set()
    for index, i in enumerate(body.items):
        row = existing_items.get(i.id) if i.id else None
        if row is not None and (row.item_type != i.item_type or (row.product_id or row.recipe_id) != i.source_id):
            row = None
        if row is None:
            # Món đã có (cùng nguồn) nhưng client không gửi id: giữ bản ghi cũ để không đổi item_key.
            row = next((r for r in existing_items.values() if r.item_type == i.item_type and (r.product_id or r.recipe_id) == i.source_id), None)
        if row is None:
            row = SurveyItem(survey_id=survey.id, item_type=i.item_type,
                             product_id=i.source_id if i.item_type == "product" else None,
                             recipe_id=i.source_id if i.item_type == "recipe" else None)
            db.add(row)
        row.group_id = key_to_id.get(i.group_key) if i.group_key else None
        row.display_name = (i.display_name or "").strip() or None
        row.sort_order = index
        await db.flush()
        kept_items.add(row.id)

    removed_items = [r for r in existing_items.values() if r.id not in kept_items]
    for r in removed_items:
        await db.delete(r)
    await db.flush()
    for gid, g in existing_groups.items():
        if gid not in kept_groups:
            await db.delete(g)
    survey.updated_at = svc.now_utc()
    await db.commit()
    for r in removed_items:
        if r.image_override_url and r.image_override_url.startswith("/uploads/surveys/"):
            delete_stored(r.image_override_url)
    await db.refresh(survey)
    return await _survey_out(db, survey)


@router.post("/survey/items/{item_id}/image")
async def upload_item_override(workshop_id: uuid.UUID, item_id: uuid.UUID, file: UploadFile = File(...),
                               db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    await require_workshop_permission(db, user, workshop_id, "surveys.manage")
    survey = await _survey(db, workshop_id)
    item = await db.get(SurveyItem, item_id)
    if item is None or item.survey_id != survey.id:
        raise HTTPException(404, "Món không thuộc khảo sát này.")
    stored = await store_image(file, f"surveys/{survey.id}")
    old = item.image_override_url
    item.image_override_url = stored.file_url
    survey.updated_at = svc.now_utc()
    await db.commit()
    delete_stored(stored.thumb_url, old)
    return {"image_override_url": item.image_override_url}


@router.delete("/survey/items/{item_id}/image", status_code=204)
async def delete_item_override(workshop_id: uuid.UUID, item_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    await require_workshop_permission(db, user, workshop_id, "surveys.manage")
    survey = await _survey(db, workshop_id)
    item = await db.get(SurveyItem, item_id)
    if item is None or item.survey_id != survey.id:
        raise HTTPException(404, "Món không thuộc khảo sát này.")
    old, item.image_override_url = item.image_override_url, None
    await db.commit()
    # Ảnh có thể vẫn nằm trong snapshot đã xuất bản; chỉ xoá file khi không phiên bản nào dùng.
    used = await db.scalar(select(func.count()).select_from(SurveyVersion).where(
        SurveyVersion.survey_id == survey.id, SurveyVersion.snapshot.cast(Text).contains(old)
    )) if old else 0
    if old and not used:
        delete_stored(old)


@router.post("/survey/hero")
async def upload_hero(workshop_id: uuid.UUID, file: UploadFile = File(...), db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    await require_workshop_permission(db, user, workshop_id, "surveys.manage")
    survey = await _survey(db, workshop_id)
    stored = await store_image(file, f"surveys/{survey.id}")
    survey.content = {**(survey.content or {}), "hero_image_url": stored.file_url}
    survey.updated_at = svc.now_utc()
    await db.commit()
    delete_stored(stored.thumb_url)
    return {"hero_image_url": stored.file_url}


@router.post("/survey/publish")
async def publish_survey(workshop_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    await require_workshop_permission(db, user, workshop_id, "surveys.manage")
    workshop = await _workshop(db, workshop_id)
    survey = await _survey(db, workshop_id)
    # Khoá hàng survey để hai lần bấm xuất bản đồng thời không tạo trùng version_no.
    await db.execute(select(Survey.id).where(Survey.id == survey.id).with_for_update())
    version = await svc.publish(db, survey, workshop, user.id)
    await db.commit()
    await db.refresh(survey)
    out = await _survey_out(db, survey)
    out["published_version_no"] = version.version_no
    return out


@router.post("/survey/close")
async def close_survey(workshop_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    await require_workshop_permission(db, user, workshop_id, "surveys.manage")
    survey = await _survey(db, workshop_id)
    survey.status = "closed"
    survey.closed_at = svc.now_utc()
    survey.updated_at = svc.now_utc()
    await db.commit()
    await db.refresh(survey)
    return await _survey_out(db, survey)


@router.post("/survey/reopen")
async def reopen_survey(workshop_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    await require_workshop_permission(db, user, workshop_id, "surveys.manage")
    survey = await _survey(db, workshop_id)
    if not survey.current_version_id:
        raise HTTPException(400, "Khảo sát chưa từng xuất bản.")
    survey.status = "published"
    survey.closed_at = None
    survey.updated_at = svc.now_utc()
    await db.commit()
    await db.refresh(survey)
    return await _survey_out(db, survey)


@router.get("/survey/preview")
async def preview_snapshot(workshop_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    """Snapshot bản nháp hiện tại (chưa xuất bản) để xem trước."""
    await require_workshop_permission(db, user, workshop_id, "surveys.read", "surveys.manage", any_of=True)
    workshop = await _workshop(db, workshop_id)
    survey = await _survey(db, workshop_id)
    return await svc.build_snapshot(db, survey, workshop)


# ---------------------------------------------------------------- gift config
@router.get("/gift-config")
async def get_gift_config(workshop_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    await require_workshop_permission(db, user, workshop_id, "surveys.read", "gifts.manage", any_of=True)
    return _gift_config_out(await db.get(GiftConfig, workshop_id))


@router.put("/gift-config")
async def save_gift_config(workshop_id: uuid.UUID, body: GiftConfigIn, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    await require_workshop_permission(db, user, workshop_id, "gifts.manage")
    await _workshop(db, workshop_id)
    if body.enabled and not body.gift_name.strip():
        raise HTTPException(400, "Nhập tên quà trước khi bật chương trình quà tặng.")
    config = await db.get(GiftConfig, workshop_id)
    if config is None:
        config = GiftConfig(workshop_id=workshop_id)
        db.add(config)
    config.enabled = body.enabled
    config.gift_name = body.gift_name.strip()
    config.description = (body.description or "").strip() or None
    config.instructions = (body.instructions or "").strip() or None
    config.eligibility = body.eligibility
    config.redeem_until = body.redeem_until
    config.updated_by = user.id
    config.updated_at = svc.now_utc()
    await db.commit()
    return _gift_config_out(config)


# ---------------------------------------------------------------- results
def _apply_filters(query, survey_id, date_from, date_to, rating, include_invalid):
    query = query.where(SurveyResponse.survey_id == survey_id)
    if not include_invalid:
        query = query.where(SurveyResponse.is_valid.is_(True))
    if date_from:
        query = query.where(SurveyResponse.submitted_at >= date_from)
    if date_to:
        query = query.where(SurveyResponse.submitted_at < date_to)
    if rating:
        query = query.where(SurveyResponse.rating == rating)
    return query


@router.get("/survey/results")
async def survey_results(
    workshop_id: uuid.UUID,
    date_from: datetime | None = None, date_to: datetime | None = None, rating: int | None = Query(None, ge=1, le=5),
    db: AsyncSession = Depends(get_db), user=Depends(current_user),
):
    await require_workshop_permission(db, user, workshop_id, "surveys.read", "surveys.manage", any_of=True)
    survey = await _survey(db, workshop_id)
    responses = (await db.execute(_apply_filters(select(SurveyResponse), survey.id, date_from, date_to, rating, False))).scalars().all()
    total = len(responses)
    ids = [r.id for r in responses]
    items = (await db.execute(select(SurveyResponseItem).where(SurveyResponseItem.response_id.in_(ids)))).scalars().all() if ids else []

    rating_dist = Counter(r.rating for r in responses if r.rating)
    rated = [r.rating for r in responses if r.rating]
    adjectives = Counter()
    for r in responses:
        adjectives.update(r.adjectives or [])
    custom = Counter()
    for r in responses:
        custom.update(a.strip().lower() for a in (r.custom_adjectives or []) if a and a.strip())

    popularity: dict[tuple, dict] = {}
    for it in items:
        key = (it.item_type, str(it.source_id))
        entry = popularity.setdefault(key, {
            "item_type": it.item_type, "source_id": str(it.source_id), "name": it.name_snapshot,
            "group": it.group_snapshot, "favorites": 0, "notes": 0, "tags": Counter(), "note_samples": [],
        })
        entry["name"] = it.name_snapshot
        if it.favorited:
            entry["favorites"] += 1
        if it.note_text or it.note_tags:
            entry["notes"] += 1
            entry["tags"].update(it.note_tags or [])
            if it.note_text and len(entry["note_samples"]) < 50:
                entry["note_samples"].append(it.note_text)
    # Món có trong phiên bản hiện hành nhưng chưa ai chọn vẫn hiện với 0%.
    if survey.current_version_id:
        version = await db.get(SurveyVersion, survey.current_version_id)
        for snap in (version.snapshot.get("items", []) if version else []):
            key = (snap["type"], snap["source_id"])
            popularity.setdefault(key, {
                "item_type": snap["type"], "source_id": snap["source_id"], "name": snap["name"],
                "group": svc.group_title(version.snapshot, snap), "favorites": 0, "notes": 0, "tags": Counter(), "note_samples": [],
            })
    pop = sorted(popularity.values(), key=lambda e: (-e["favorites"], -e["notes"], e["name"]))
    for e in pop:
        e["rate"] = round(e["favorites"] / total, 4) if total else 0.0
        e["tags"] = [{"tag": t, "count": c} for t, c in e["tags"].most_common()]

    claims = (await db.execute(select(GiftClaim).where(GiftClaim.survey_id == survey.id))).scalars().all()
    config = await db.get(GiftConfig, workshop_id)
    gift_counts = Counter(effective_status(c, config) for c in claims)
    sessions = dict((await db.execute(
        select(SurveySession.status, func.count()).where(SurveySession.survey_id == survey.id).group_by(SurveySession.status)
    )).all())
    return {
        "total_responses": total,
        "sessions": {"draft": sessions.get("draft", 0), "submitted": sessions.get("submitted", 0)},
        "invalid_responses": await db.scalar(select(func.count()).select_from(SurveyResponse).where(
            SurveyResponse.survey_id == survey.id, SurveyResponse.is_valid.is_(False))),
        "rating": {
            "average": round(sum(rated) / len(rated), 2) if rated else None, "count": len(rated),
            "distribution": [{"rating": n, "count": rating_dist.get(n, 0)} for n in range(1, 6)],
        },
        "popularity": pop,
        "adjectives": [{"label": a, "count": c} for a, c in adjectives.most_common()],
        "custom_adjectives": [{"label": a, "count": c} for a, c in custom.most_common(50)],
        "discomfort": [{"response_id": str(r.id), "name": r.full_name, "text": r.discomfort, "submitted_at": r.submitted_at.isoformat()}
                       for r in responses if r.discomfort],
        "expectation": [{"response_id": str(r.id), "name": r.full_name, "text": r.expectation, "submitted_at": r.submitted_at.isoformat()}
                        for r in responses if r.expectation],
        "gifts": {"issued": gift_counts.get("issued", 0), "redeemed": gift_counts.get("redeemed", 0),
                  "expired": gift_counts.get("expired", 0), "revoked": gift_counts.get("revoked", 0), "total": len(claims)},
    }


async def _responses_rows(db, survey, date_from, date_to, rating, include_invalid, q):
    query = _apply_filters(select(SurveyResponse), survey.id, date_from, date_to, rating, include_invalid)
    if q:
        digits = "".join(c for c in q if c.isdigit())
        query = query.where(SurveyResponse.full_name.ilike(f"%{q.strip()}%") | (SurveyResponse.phone.contains(digits) if len(digits) >= 3 else False))
    return (await db.execute(query.order_by(SurveyResponse.submitted_at.desc()))).scalars().all()


@router.get("/survey/responses")
async def list_responses(
    workshop_id: uuid.UUID, q: str | None = None,
    date_from: datetime | None = None, date_to: datetime | None = None, rating: int | None = Query(None, ge=1, le=5),
    include_invalid: bool = False, gift: Literal["any", "issued", "redeemed", "none"] = "any",
    db: AsyncSession = Depends(get_db), user=Depends(current_user),
):
    await require_workshop_permission(db, user, workshop_id, "surveys.read", "surveys.manage", any_of=True)
    survey = await _survey(db, workshop_id)
    rows = await _responses_rows(db, survey, date_from, date_to, rating, include_invalid, q)
    config = await db.get(GiftConfig, workshop_id)
    claims = {c.response_id: c for c in (await db.execute(select(GiftClaim).where(GiftClaim.survey_id == survey.id))).scalars()}
    out = []
    for r in rows:
        claim = claims.get(r.id)
        status = effective_status(claim, config) if claim else None
        if gift == "none" and claim:
            continue
        if gift in ("issued", "redeemed") and status != gift:
            continue
        out.append({
            "id": str(r.id), "full_name": r.full_name, "phone_masked": mask_phone(r.phone), "rating": r.rating,
            "favorite_count": r.favorite_count, "adjectives": (r.adjectives or []) + (r.custom_adjectives or []),
            "has_feedback": bool(r.discomfort or r.expectation), "is_valid": r.is_valid,
            "registered": r.guest_id is not None, "gift_status": status, "claim_id": str(claim.id) if claim else None,
            "submitted_at": r.submitted_at.isoformat(),
        })
    return out


@router.get("/survey/responses/{response_id}")
async def get_response(workshop_id: uuid.UUID, response_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    await require_workshop_permission(db, user, workshop_id, "surveys.read", "surveys.manage", any_of=True)
    survey = await _survey(db, workshop_id)
    r = await db.get(SurveyResponse, response_id)
    if r is None or r.survey_id != survey.id:
        raise HTTPException(404, "Không tìm thấy phiếu.")
    items = (await db.execute(select(SurveyResponseItem).where(SurveyResponseItem.response_id == r.id))).scalars().all()
    version = await db.get(SurveyVersion, r.version_id)
    claim = (await db.execute(select(GiftClaim).where(GiftClaim.response_id == r.id))).scalar_one_or_none()
    return {
        "id": str(r.id), "full_name": r.full_name, "phone_masked": mask_phone(r.phone), "rating": r.rating,
        "adjectives": r.adjectives, "custom_adjectives": r.custom_adjectives, "discomfort": r.discomfort,
        "expectation": r.expectation, "is_valid": r.is_valid, "registered": r.guest_id is not None,
        "submitted_at": r.submitted_at.isoformat(), "version_no": version.version_no if version else None,
        "items": [{"name": i.name_snapshot, "group": i.group_snapshot, "item_type": i.item_type, "favorited": i.favorited,
                   "note_tags": i.note_tags, "note_text": i.note_text} for i in items],
        "gift": {"status": effective_status(claim, await db.get(GiftConfig, workshop_id)), "gift_name": claim.gift_name_snapshot,
                 "redeemed_at": claim.redeemed_at.isoformat() if claim.redeemed_at else None} if claim else None,
    }


@router.patch("/survey/responses/{response_id}")
async def update_response(workshop_id: uuid.UUID, response_id: uuid.UUID, body: ResponsePatch,
                          db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    """Đánh dấu phiếu không hợp lệ (spam/trùng) — không xoá dữ liệu."""
    await require_workshop_permission(db, user, workshop_id, "surveys.manage")
    survey = await _survey(db, workshop_id)
    r = await db.get(SurveyResponse, response_id)
    if r is None or r.survey_id != survey.id:
        raise HTTPException(404, "Không tìm thấy phiếu.")
    r.is_valid = body.is_valid
    await db.commit()
    return {"id": str(r.id), "is_valid": r.is_valid}


@router.get("/survey/export.xlsx")
async def export_responses(
    workshop_id: uuid.UUID, date_from: datetime | None = None, date_to: datetime | None = None,
    rating: int | None = Query(None, ge=1, le=5), include_invalid: bool = False,
    db: AsyncSession = Depends(get_db), user=Depends(current_user),
):
    await require_workshop_permission(db, user, workshop_id, "surveys.read", "surveys.manage", any_of=True)
    granted = await workshop_permissions(db, user, workshop_id)
    if not ({"reports.export", "surveys.manage"} & granted):
        raise HTTPException(403, "missing permission: reports.export")
    full_phone = "guests.export" in granted
    workshop = await _workshop(db, workshop_id)
    survey = await _survey(db, workshop_id)
    rows = await _responses_rows(db, survey, date_from, date_to, rating, include_invalid, None)
    ids = [r.id for r in rows]
    items = (await db.execute(select(SurveyResponseItem).where(SurveyResponseItem.response_id.in_(ids)))).scalars().all() if ids else []
    by_resp: dict[uuid.UUID, list] = {}
    for it in items:
        by_resp.setdefault(it.response_id, []).append(it)
    config = await db.get(GiftConfig, workshop_id)
    claims = {c.response_id: c for c in (await db.execute(select(GiftClaim).where(GiftClaim.survey_id == survey.id))).scalars()}

    wb = Workbook()
    ws = wb.active
    ws.title = "Phiếu khảo sát"
    ws.append(["Gửi lúc", "Tên", "Số điện thoại", "Có đăng ký", "Hài lòng", "Món đã thích", "Nhận xét từng món",
               "Tính từ", "Chưa thoải mái", "Mong đợi", "Quà", "Hợp lệ"])
    for r in rows:
        its = by_resp.get(r.id, [])
        claim = claims.get(r.id)
        ws.append([
            r.submitted_at.astimezone().strftime("%d/%m/%Y %H:%M"), r.full_name,
            r.phone if full_phone else mask_phone(r.phone), "Có" if r.guest_id else "Không", r.rating,
            ", ".join(i.name_snapshot for i in its if i.favorited),
            " | ".join(f"{i.name_snapshot}: {', '.join(i.note_tags or [])} {i.note_text or ''}".strip() for i in its if i.note_text or i.note_tags),
            ", ".join((r.adjectives or []) + (r.custom_adjectives or [])), r.discomfort or "", r.expectation or "",
            effective_status(claim, config) if claim else "", "Có" if r.is_valid else "Không",
        ])
    ws2 = wb.create_sheet("Độ phổ biến món")
    ws2.append(["Món", "Loại", "Nhóm", "Lượt thích", "Tỷ lệ", "Số nhận xét"])
    pop: dict[tuple, list] = {}
    for it in items:
        entry = pop.setdefault((it.item_type, it.source_id), [it.name_snapshot, "Sản phẩm" if it.item_type == "product" else "Công thức", it.group_snapshot or "", 0, 0])
        entry[3] += 1 if it.favorited else 0
        entry[4] += 1 if (it.note_text or it.note_tags) else 0
    total = len(rows)
    for e in sorted(pop.values(), key=lambda e: -e[3]):
        ws2.append([e[0], e[1], e[2], e[3], f"{(e[3] / total * 100):.1f}%" if total else "0%", e[4]])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"khao-sat-{workshop.slug or workshop.id}.xlsx"
    return StreamingResponse(
        buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


# ---------------------------------------------------------------- gift report
@router.get("/gifts")
async def gift_report(workshop_id: uuid.UUID, status: str | None = None, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    await require_workshop_permission(db, user, workshop_id, "surveys.read", "gifts.manage", "gifts.redeem", any_of=True)
    config = await db.get(GiftConfig, workshop_id)
    claims = (await db.execute(
        select(GiftClaim, SurveyResponse).join(SurveyResponse, SurveyResponse.id == GiftClaim.response_id)
        .where(GiftClaim.workshop_id == workshop_id).order_by(GiftClaim.issued_at.desc())
    )).all()
    users = {}
    redeemer_ids = {c.redeemed_by for c, _ in claims if c.redeemed_by}
    if redeemer_ids:
        users = {u.id: (u.name or u.email or u.username) for u in (await db.execute(select(AdminUser).where(AdminUser.id.in_(redeemer_ids)))).scalars()}
    rows = []
    counts = Counter()
    for claim, response in claims:
        st = effective_status(claim, config)
        counts[st] += 1
        if status and st != status:
            continue
        rows.append({
            "claim_id": str(claim.id), "status": st, "gift_name": claim.gift_name_snapshot,
            "guest_name": response.full_name, "phone_masked": mask_phone(response.phone),
            "issued_at": claim.issued_at.isoformat(), "redeemed_at": claim.redeemed_at.isoformat() if claim.redeemed_at else None,
            "redeemed_by": users.get(claim.redeemed_by), "revoke_reason": claim.revoke_reason,
        })
    return {"config": _gift_config_out(config), "counts": dict(counts), "total": len(claims), "claims": rows}


@router.post("/gifts/{claim_id}/revoke")
async def revoke_claim(workshop_id: uuid.UUID, claim_id: uuid.UUID, body: RevokeIn, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    await require_workshop_permission(db, user, workshop_id, "gifts.manage")
    claim = (await db.execute(select(GiftClaim).where(GiftClaim.id == claim_id).with_for_update())).scalar_one_or_none()
    if claim is None or claim.workshop_id != workshop_id:
        raise HTTPException(404, "Không tìm thấy quà.")
    if claim.status == "redeemed":
        raise HTTPException(409, "Quà đã được trao, không thể thu hồi.")
    if claim.status != "revoked":
        claim.status = "revoked"
        claim.revoked_at = svc.now_utc()
        claim.revoked_by = user.id
        claim.revoke_reason = body.reason.strip()
        claim.updated_at = svc.now_utc()
        db.add(GiftAuditLog(workshop_id=workshop_id, claim_id=claim.id, action="revoke", result="ok",
                            actor_user_id=user.id, detail={"reason": claim.revoke_reason}))
    await db.commit()
    return {"claim_id": str(claim.id), "status": claim.status}


@router.get("/gifts/audit")
async def gift_audit(workshop_id: uuid.UUID, limit: int = Query(50, ge=1, le=500), db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    await require_workshop_permission(db, user, workshop_id, "gifts.manage", "gifts.redeem", any_of=True)
    rows = (await db.execute(
        select(GiftAuditLog, AdminUser.name, AdminUser.email, AdminUser.username)
        .outerjoin(AdminUser, AdminUser.id == GiftAuditLog.actor_user_id)
        .where(GiftAuditLog.workshop_id == workshop_id).order_by(GiftAuditLog.created_at.desc()).limit(limit)
    )).all()
    return [{
        "id": str(log.id), "claim_id": str(log.claim_id) if log.claim_id else None, "action": log.action, "result": log.result,
        "actor": name or email or username, "created_at": log.created_at.isoformat(),
        "method": (log.detail or {}).get("method"),
    } for log, name, email, username in rows]
