"""Danh mục sản phẩm & công thức dùng chung cho mọi workshop."""
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import current_user, require_permission
from ..auth.local_accounts import is_checkin_guest
from ..auth.permissions import effective_permissions_for_user
from ..auth.workshop_access import allowed_workshop_ids
from ..db import get_db
from ..models import (
    AdminUser, CatalogCategory, CatalogImage, CatalogProduct, CatalogRecipe, CatalogRecipeProduct, SurveyItem,
)
from ..services.catalog_images import delete_stored, store_image
from ..services.survey_text import search_key

router = APIRouter(prefix="/api/catalog", tags=["catalog"])

Kind = Literal["products", "recipes"]
STATUSES = ("active", "inactive", "archived")
MAX_IMAGES = 12


def _now():
    return datetime.now(timezone.utc)


async def catalog_reader(user: AdminUser = Depends(current_user), db: AsyncSession = Depends(get_db)) -> AdminUser:
    """Đọc catalog: quyền catalog.read toàn cục, hoặc được cấu hình survey ở ít nhất một workshop."""
    if is_checkin_guest(user):
        raise HTTPException(403, "Tài khoản khách không xem được danh mục sản phẩm.")
    granted = await effective_permissions_for_user(db, user.role, user.permission_overrides)
    if "catalog.read" in granted or "catalog.manage" in granted:
        return user
    scope = await allowed_workshop_ids(db, user, "surveys.manage")
    if scope is None or scope:
        return user
    raise HTTPException(403, "missing permission: catalog.read")


catalog_manager = require_permission("catalog.manage")


# ---------------------------------------------------------------- schemas
class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    parent_id: uuid.UUID | None = None
    sort_order: int | None = None
    is_active: bool = True


class CategoryPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    parent_id: uuid.UUID | None = None
    clear_parent: bool = False
    sort_order: int | None = None
    is_active: bool | None = None


class ItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category_id: uuid.UUID | None = None
    short_description: str | None = Field(default=None, max_length=1000)
    instructions: str | None = Field(default=None, max_length=10000)
    status: Literal["active", "inactive", "archived"] = "active"
    sort_order: int | None = None
    product_ids: list[uuid.UUID] | None = None  # chỉ cho công thức


class ItemPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    category_id: uuid.UUID | None = None
    clear_category: bool = False
    short_description: str | None = Field(default=None, max_length=1000)
    instructions: str | None = Field(default=None, max_length=10000)
    status: Literal["active", "inactive", "archived"] | None = None
    sort_order: int | None = None
    product_ids: list[uuid.UUID] | None = None


class ImagePatch(BaseModel):
    alt: str | None = Field(default=None, max_length=200)
    focus_y: int | None = Field(default=None, ge=0, le=100)


def _model(kind: str):
    return CatalogProduct if kind == "products" else CatalogRecipe


def _image_out(img: CatalogImage) -> dict:
    return {
        "id": str(img.id), "file_url": img.file_url, "thumb_url": img.thumb_url, "width": img.width,
        "height": img.height, "alt": img.alt, "focus_y": img.focus_y, "sort_order": img.sort_order,
    }


def _category_out(c: CatalogCategory, counts: dict) -> dict:
    return {
        "id": str(c.id), "parent_id": str(c.parent_id) if c.parent_id else None, "name": c.name,
        "sort_order": c.sort_order, "is_active": c.is_active,
        "product_count": counts.get(("p", c.id), 0), "recipe_count": counts.get(("r", c.id), 0),
    }


async def _images_for(db: AsyncSession, kind: str, ids: list[uuid.UUID]) -> dict[uuid.UUID, list[CatalogImage]]:
    if not ids:
        return {}
    col = CatalogImage.product_id if kind == "products" else CatalogImage.recipe_id
    rows = (await db.execute(select(CatalogImage).where(col.in_(ids)).order_by(CatalogImage.sort_order, CatalogImage.created_at))).scalars().all()
    out: dict[uuid.UUID, list[CatalogImage]] = {}
    for img in rows:
        out.setdefault(img.product_id or img.recipe_id, []).append(img)
    return out


async def _usage(db: AsyncSession, kind: str, ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not ids:
        return {}
    col = SurveyItem.product_id if kind == "products" else SurveyItem.recipe_id
    rows = (await db.execute(select(col, func.count()).where(col.in_(ids)).group_by(col))).all()
    return {row[0]: row[1] for row in rows}


async def _recipe_links(db: AsyncSession, recipe_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[uuid.UUID]]:
    if not recipe_ids:
        return {}
    rows = (await db.execute(
        select(CatalogRecipeProduct).where(CatalogRecipeProduct.recipe_id.in_(recipe_ids)).order_by(CatalogRecipeProduct.sort_order)
    )).scalars().all()
    out: dict[uuid.UUID, list[uuid.UUID]] = {}
    for link in rows:
        out.setdefault(link.recipe_id, []).append(link.product_id)
    return out


async def _items_out(db: AsyncSession, kind: str, rows: list) -> list[dict]:
    ids = [r.id for r in rows]
    images = await _images_for(db, kind, ids)
    usage = await _usage(db, kind, ids)
    links = await _recipe_links(db, ids) if kind == "recipes" else {}
    if kind == "products" and ids:
        recipe_counts = dict((await db.execute(
            select(CatalogRecipeProduct.product_id, func.count()).where(CatalogRecipeProduct.product_id.in_(ids)).group_by(CatalogRecipeProduct.product_id)
        )).all())
    else:
        recipe_counts = {}
    out = []
    for r in rows:
        item = {
            "id": str(r.id), "item_type": "product" if kind == "products" else "recipe", "name": r.name,
            "category_id": str(r.category_id) if r.category_id else None,
            "short_description": r.short_description, "status": r.status, "sort_order": r.sort_order,
            "images": [_image_out(i) for i in images.get(r.id, [])],
            "survey_usage": usage.get(r.id, 0),
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        if kind == "recipes":
            item["instructions"] = r.instructions
            item["product_ids"] = [str(p) for p in links.get(r.id, [])]
        else:
            item["recipe_count"] = recipe_counts.get(r.id, 0)
        out.append(item)
    return out


async def _get(db: AsyncSession, kind: str, item_id: uuid.UUID):
    row = await db.get(_model(kind), item_id)
    if row is None:
        raise HTTPException(404, "Không tìm thấy mục trong danh mục.")
    return row


async def _check_category(db: AsyncSession, category_id: uuid.UUID | None) -> None:
    if category_id and await db.get(CatalogCategory, category_id) is None:
        raise HTTPException(400, "Danh mục không tồn tại.")


async def _set_recipe_products(db: AsyncSession, recipe_id: uuid.UUID, product_ids: list[uuid.UUID]) -> None:
    unique = list(dict.fromkeys(product_ids))
    if unique:
        found = set((await db.execute(select(CatalogProduct.id).where(CatalogProduct.id.in_(unique)))).scalars())
        missing = [p for p in unique if p not in found]
        if missing:
            raise HTTPException(400, "Có sản phẩm liên kết không tồn tại.")
    await db.execute(delete(CatalogRecipeProduct).where(CatalogRecipeProduct.recipe_id == recipe_id))
    for index, product_id in enumerate(unique):
        db.add(CatalogRecipeProduct(recipe_id=recipe_id, product_id=product_id, sort_order=index))


# ---------------------------------------------------------------- categories
@router.get("/categories")
async def list_categories(db: AsyncSession = Depends(get_db), user=Depends(catalog_reader)):
    rows = (await db.execute(select(CatalogCategory).order_by(CatalogCategory.sort_order, CatalogCategory.name))).scalars().all()
    counts = {}
    for model, tag in ((CatalogProduct, "p"), (CatalogRecipe, "r")):
        for cid, n in (await db.execute(
            select(model.category_id, func.count()).where(model.status != "archived").group_by(model.category_id)
        )).all():
            counts[(tag, cid)] = n
    return [_category_out(c, counts) for c in rows]


@router.post("/categories", status_code=201)
async def create_category(body: CategoryIn, db: AsyncSession = Depends(get_db), user=Depends(catalog_manager)):
    if body.parent_id:
        parent = await db.get(CatalogCategory, body.parent_id)
        if parent is None:
            raise HTTPException(400, "Danh mục cha không tồn tại.")
        if parent.parent_id is not None:
            raise HTTPException(400, "Danh mục chỉ hỗ trợ 2 cấp.")
    order = body.sort_order
    if order is None:
        order = (await db.scalar(select(func.coalesce(func.max(CatalogCategory.sort_order), -1)).where(
            CatalogCategory.parent_id.is_(None) if body.parent_id is None else CatalogCategory.parent_id == body.parent_id
        ))) + 1
    c = CatalogCategory(name=body.name.strip(), parent_id=body.parent_id, sort_order=order, is_active=body.is_active)
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return _category_out(c, {})


@router.patch("/categories/{category_id}")
async def update_category(category_id: uuid.UUID, body: CategoryPatch, db: AsyncSession = Depends(get_db), user=Depends(catalog_manager)):
    c = await db.get(CatalogCategory, category_id)
    if c is None:
        raise HTTPException(404, "Không tìm thấy danh mục.")
    if body.name is not None:
        c.name = body.name.strip()
    if body.clear_parent:
        c.parent_id = None
    elif body.parent_id is not None:
        if body.parent_id == c.id:
            raise HTTPException(400, "Danh mục không thể là cha của chính nó.")
        parent = await db.get(CatalogCategory, body.parent_id)
        if parent is None or parent.parent_id is not None:
            raise HTTPException(400, "Danh mục cha phải là danh mục cấp 1.")
        has_children = await db.scalar(select(func.count()).where(CatalogCategory.parent_id == c.id))
        if has_children:
            raise HTTPException(400, "Danh mục đang có danh mục con nên không thể chuyển thành cấp 2.")
        c.parent_id = body.parent_id
    if body.sort_order is not None:
        c.sort_order = body.sort_order
    if body.is_active is not None:
        c.is_active = body.is_active
    c.updated_at = _now()
    await db.commit()
    await db.refresh(c)
    return _category_out(c, {})


@router.delete("/categories/{category_id}", status_code=204)
async def delete_category(category_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(catalog_manager)):
    c = await db.get(CatalogCategory, category_id)
    if c is None:
        raise HTTPException(404, "Không tìm thấy danh mục.")
    if await db.scalar(select(func.count()).where(CatalogCategory.parent_id == c.id)):
        raise HTTPException(409, "Hãy xoá hoặc chuyển các danh mục con trước.")
    in_use = (await db.scalar(select(func.count()).select_from(CatalogProduct).where(CatalogProduct.category_id == c.id))) + (
        await db.scalar(select(func.count()).select_from(CatalogRecipe).where(CatalogRecipe.category_id == c.id)))
    if in_use:
        raise HTTPException(409, f"Danh mục đang có {in_use} sản phẩm/công thức. Chuyển chúng sang danh mục khác trước khi xoá.")
    await db.delete(c)
    await db.commit()


@router.put("/categories/order")
async def reorder_categories(body: list[uuid.UUID], db: AsyncSession = Depends(get_db), user=Depends(catalog_manager)):
    rows = {c.id: c for c in (await db.execute(select(CatalogCategory).where(CatalogCategory.id.in_(body)))).scalars()}
    for index, cid in enumerate(body):
        if cid in rows:
            rows[cid].sort_order = index
    await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- unified picker
@router.get("/items")
async def catalog_items(
    q: str | None = None,
    item_type: Literal["product", "recipe"] | None = None,
    category_id: uuid.UUID | None = None,
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db), user=Depends(catalog_reader),
):
    """Catalog hợp nhất (SurveyCatalogItem) cho bộ chọn của survey — không nhân bản dữ liệu."""
    results = []
    key = search_key(q) if q else ""
    for kind, model, type_name in (("products", CatalogProduct, "product"), ("recipes", CatalogRecipe, "recipe")):
        if item_type and item_type != type_name:
            continue
        query = select(model).where(model.status != "archived")
        if not include_inactive:
            query = query.where(model.status == "active")
        if category_id:
            sub_ids = select(CatalogCategory.id).where(or_(CatalogCategory.id == category_id, CatalogCategory.parent_id == category_id))
            query = query.where(model.category_id.in_(sub_ids))
        if key:
            query = query.where(model.search_key.contains(key))
        rows = (await db.execute(query.order_by(model.sort_order, model.name).limit(500))).scalars().all()
        images = await _images_for(db, kind, [r.id for r in rows])
        for r in rows:
            pics = images.get(r.id, [])
            results.append({
                "item_type": type_name, "source_id": str(r.id), "name": r.name,
                "category_id": str(r.category_id) if r.category_id else None, "status": r.status,
                "thumb_url": pics[0].thumb_url if pics else None, "image_count": len(pics),
            })
    return results


@router.patch("/images/{image_id}")
async def update_image(image_id: uuid.UUID, body: ImagePatch, db: AsyncSession = Depends(get_db), user=Depends(catalog_manager)):
    img = await db.get(CatalogImage, image_id)
    if img is None:
        raise HTTPException(404, "Không tìm thấy ảnh.")
    if body.alt is not None:
        img.alt = body.alt.strip() or None
    if body.focus_y is not None:
        img.focus_y = body.focus_y
    await db.commit()
    return _image_out(img)


@router.delete("/images/{image_id}", status_code=204)
async def delete_image(image_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(catalog_manager)):
    img = await db.get(CatalogImage, image_id)
    if img is None:
        raise HTTPException(404, "Không tìm thấy ảnh.")
    urls = (img.file_url, img.thumb_url)
    await db.delete(img)
    await db.commit()
    delete_stored(*urls)


# ---------------------------------------------------------------- products / recipes
@router.get("/{kind}")
async def list_items(
    kind: Kind, q: str | None = None, category_id: uuid.UUID | None = None,
    status: Literal["active", "inactive", "archived", "all"] = "all",
    db: AsyncSession = Depends(get_db), user=Depends(catalog_reader),
):
    model = _model(kind)
    query = select(model)
    if status == "all":
        query = query.where(model.status != "archived")
    else:
        query = query.where(model.status == status)
    if category_id:
        sub_ids = select(CatalogCategory.id).where(or_(CatalogCategory.id == category_id, CatalogCategory.parent_id == category_id))
        query = query.where(model.category_id.in_(sub_ids))
    if q:
        query = query.where(model.search_key.contains(search_key(q)))
    rows = (await db.execute(query.order_by(model.sort_order, model.name))).scalars().all()
    return await _items_out(db, kind, rows)


@router.post("/{kind}", status_code=201)
async def create_item(kind: Kind, body: ItemIn, db: AsyncSession = Depends(get_db), user=Depends(catalog_manager)):
    model = _model(kind)
    await _check_category(db, body.category_id)
    order = body.sort_order
    if order is None:
        order = (await db.scalar(select(func.coalesce(func.max(model.sort_order), -1)))) + 1
    name = body.name.strip()
    row = model(name=name, search_key=search_key(name), category_id=body.category_id,
                short_description=(body.short_description or "").strip() or None, status=body.status,
                sort_order=order, created_by=user.id)
    if kind == "recipes":
        row.instructions = (body.instructions or "").strip() or None
    db.add(row)
    await db.flush()
    if kind == "recipes" and body.product_ids:
        await _set_recipe_products(db, row.id, body.product_ids)
    await db.commit()
    await db.refresh(row)
    return (await _items_out(db, kind, [row]))[0]


@router.get("/{kind}/{item_id}")
async def get_item(kind: Kind, item_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(catalog_reader)):
    return (await _items_out(db, kind, [await _get(db, kind, item_id)]))[0]


@router.patch("/{kind}/{item_id}")
async def update_item(kind: Kind, item_id: uuid.UUID, body: ItemPatch, db: AsyncSession = Depends(get_db), user=Depends(catalog_manager)):
    row = await _get(db, kind, item_id)
    if body.name is not None:
        row.name = body.name.strip()
        row.search_key = search_key(row.name)
    if body.clear_category:
        row.category_id = None
    elif body.category_id is not None:
        await _check_category(db, body.category_id)
        row.category_id = body.category_id
    if body.short_description is not None:
        row.short_description = body.short_description.strip() or None
    if kind == "recipes" and body.instructions is not None:
        row.instructions = body.instructions.strip() or None
    if body.status is not None:
        row.status = body.status
    if body.sort_order is not None:
        row.sort_order = body.sort_order
    if kind == "recipes" and body.product_ids is not None:
        await _set_recipe_products(db, row.id, body.product_ids)
    row.updated_at = _now()
    await db.commit()
    await db.refresh(row)
    return (await _items_out(db, kind, [row]))[0]


@router.delete("/{kind}/{item_id}", status_code=204)
async def delete_item(kind: Kind, item_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(catalog_manager)):
    """Xoá hẳn chỉ khi chưa từng gắn vào survey; nếu đã dùng thì lưu trữ để giữ lịch sử."""
    row = await _get(db, kind, item_id)
    if (await _usage(db, kind, [row.id])).get(row.id):
        raise HTTPException(409, "Mục này đang nằm trong khảo sát. Hãy chuyển trạng thái sang Lưu trữ thay vì xoá.")
    col = CatalogImage.product_id if kind == "products" else CatalogImage.recipe_id
    images = (await db.execute(select(CatalogImage).where(col == row.id))).scalars().all()
    await db.delete(row)
    await db.commit()
    for img in images:
        delete_stored(img.file_url, img.thumb_url)


# ---------------------------------------------------------------- images
@router.post("/{kind}/{item_id}/images", status_code=201)
async def upload_images(kind: Kind, item_id: uuid.UUID, files: list[UploadFile] = File(...),
                        db: AsyncSession = Depends(get_db), user=Depends(catalog_manager)):
    row = await _get(db, kind, item_id)
    col = CatalogImage.product_id if kind == "products" else CatalogImage.recipe_id
    count = await db.scalar(select(func.count()).select_from(CatalogImage).where(col == row.id))
    if count + len(files) > MAX_IMAGES:
        raise HTTPException(400, f"Mỗi mục tối đa {MAX_IMAGES} ảnh.")
    max_order = await db.scalar(select(func.coalesce(func.max(CatalogImage.sort_order), -1)).where(col == row.id))
    stored = []
    try:
        for f in files:
            stored.append(await store_image(f, f"catalog/{kind}/{row.id}"))
    except HTTPException:
        for s in stored:
            delete_stored(s.file_url, s.thumb_url)
        raise
    for s in stored:
        max_order += 1
        db.add(CatalogImage(
            product_id=row.id if kind == "products" else None, recipe_id=row.id if kind == "recipes" else None,
            file_url=s.file_url, thumb_url=s.thumb_url, width=s.width, height=s.height, alt=row.name, sort_order=max_order,
        ))
    row.updated_at = _now()
    await db.commit()
    return (await _items_out(db, kind, [row]))[0]


@router.put("/{kind}/{item_id}/images/order")
async def reorder_images(kind: Kind, item_id: uuid.UUID, body: list[uuid.UUID], db: AsyncSession = Depends(get_db), user=Depends(catalog_manager)):
    row = await _get(db, kind, item_id)
    col = CatalogImage.product_id if kind == "products" else CatalogImage.recipe_id
    images = {i.id: i for i in (await db.execute(select(CatalogImage).where(col == row.id))).scalars()}
    if set(body) != set(images):
        raise HTTPException(400, "Danh sách ảnh không khớp.")
    for index, image_id in enumerate(body):
        images[image_id].sort_order = index
    row.updated_at = _now()
    await db.commit()
    return (await _items_out(db, kind, [row]))[0]
