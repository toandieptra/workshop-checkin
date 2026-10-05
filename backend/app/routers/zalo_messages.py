import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth.dependencies import current_user, require_any_permission, require_permission
from ..auth.workshop_access import allowed_workshop_ids, require_workshop_permission
from ..db import get_db
from ..models import Guest, Workshop, ZaloDelivery, ZaloDeliveryBatch, ZaloDeliveryItem, ZaloTemplate
from ..schemas import (ZaloBatchSendRequest, ZaloDeliveryItemOut, ZaloDeliveryOut,
                       ZaloGuestSendStatusOut, ZaloPreflightRequest, ZaloSendRequest, ZaloTemplateCreate,
                       ZaloTemplateOut, ZaloTemplateToggleRequest, ZaloTemplateUpdate)
from ..services.zalo_messages import (cache_remote_media, create_delivery, quota_usage,
                                          guest_send_status, reopen_quota, resolve_recipient, resolve_recipients, save_media,
                                          selected_guests, TEMPLATE_VARIABLES,
                                          validate_blocks)

router = APIRouter(prefix="/api/zalo", tags=["zalo-messages"])


@router.get("/template-variables", dependencies=[Depends(require_permission("zalo_templates.read"))])
async def list_template_variables():
    labels = {
        "full_name": "Họ tên khách", "phone": "Số điện thoại", "email": "Email",
        "company": "Công ty", "role_title": "Chức vụ", "business_model": "Mô hình kinh doanh",
        "guest_type": "Loại khách", "party_size": "Số khách đăng ký",
        "actual_party_size": "Số khách thực tế", "registration_status": "Trạng thái đăng ký",
        "checkin_status": "Trạng thái check-in", "workshop_name": "Tên workshop",
        "workshop_date": "Ngày tổ chức", "workshop_time": "Giờ tổ chức",
        "workshop_location": "Địa điểm", "workshop_branch": "Chi nhánh",
    }
    return {
        "guest": [{"name": name, "placeholder": f"{{{{{name}}}}}", "label": labels[name]} for name in TEMPLATE_VARIABLES["guest"]],
        "workshop": [{"name": name, "placeholder": f"{{{{{name}}}}}", "label": labels[name]} for name in TEMPLATE_VARIABLES["workshop"]],
    }


def _template(template):
    return ZaloTemplateOut.model_validate(template)


async def _delivery(db: AsyncSession, delivery_id: uuid.UUID) -> ZaloDelivery:
    return (await db.execute(select(ZaloDelivery).options(
        selectinload(ZaloDelivery.items)
    ).where(ZaloDelivery.id == delivery_id))).scalar_one()



async def _authorize_recipients(db, user, guests, *, bulk=False, workshop_id=None):
    scope_ids = {guest.workshop_id for guest in guests}
    if workshop_id is not None:
        scope_ids.add(workshop_id)
    for scope_id in scope_ids:
        if bulk:
            await require_workshop_permission(db, user, scope_id, "guests.read")
            await require_workshop_permission(db, user, scope_id,
                "zalo_messages.send", "zalo_messages.bulk_send", any_of=True)
        else:
            await require_workshop_permission(db, user, scope_id, "zalo_messages.send")


async def _selected_for_user(db, user, body):
    guests = await selected_guests(db, body.guest_ids, body.workshop_id)
    if body.guest_ids and set(body.guest_ids) != {guest.id for guest in guests}:
        raise HTTPException(404, "Không tìm thấy đủ khách đã chọn")
    await _authorize_recipients(db, user, guests, bulk=True, workshop_id=body.workshop_id)
    return guests


async def _authorize_delivery(db, user, delivery_id, *, bulk=False, permission="zalo_messages.read"):
    scope_ids = set((await db.execute(
        select(Guest.workshop_id).select_from(ZaloDeliveryItem)
        .outerjoin(Guest, Guest.id == ZaloDeliveryItem.guest_id)
        .where(ZaloDeliveryItem.delivery_id == delivery_id)
    )).scalars().all())
    if not scope_ids or None in scope_ids:
        raise HTTPException(403, "Không xác định được workshop của lượt gửi")
    for scope_id in scope_ids:
        if bulk:
            await require_workshop_permission(db, user, scope_id, "guests.read")
            await require_workshop_permission(db, user, scope_id,
                "zalo_messages.send", "zalo_messages.bulk_send", any_of=True)
        else:
            await require_workshop_permission(db, user, scope_id, permission)


async def _visible_deliveries(db, user):
    accessible = await allowed_workshop_ids(db, user, "zalo_messages.read")
    items = select(ZaloDeliveryItem.id).where(ZaloDeliveryItem.delivery_id == ZaloDelivery.id).correlate(ZaloDelivery)
    unresolved = Guest.id.is_(None)
    if accessible is not None:
        unresolved = or_(unresolved, Guest.workshop_id.not_in(accessible))
    forbidden = (select(ZaloDeliveryItem.id).outerjoin(Guest, Guest.id == ZaloDeliveryItem.guest_id)
                 .where(ZaloDeliveryItem.delivery_id == ZaloDelivery.id, unresolved).correlate(ZaloDelivery))
    return items.exists() & ~forbidden.exists()


async def _with_item_scopes(db, delivery):
    guest_ids = {item.guest_id for item in delivery.items if item.guest_id}
    scopes = dict((await db.execute(select(Guest.id, Guest.workshop_id).where(Guest.id.in_(guest_ids)))).all()) if guest_ids else {}
    for item in delivery.items:
        item.workshop_id = scopes.get(item.guest_id)
    return delivery

@router.get("/templates", response_model=list[ZaloTemplateOut], dependencies=[Depends(require_permission("zalo_templates.read"))])
async def list_templates(response: Response, search: str | None = None, status: str | None = None,
                         media_type: str | None = None, offset: int = Query(0, ge=0),
                         limit: int = Query(20, ge=1, le=100), db: AsyncSession = Depends(get_db)):
    stmt = select(ZaloTemplate)
    if search:
        term = f"%{search.strip()}%"
        stmt = stmt.where(or_(ZaloTemplate.name.ilike(term), ZaloTemplate.description.ilike(term)))
    if status:
        if status not in {"draft", "active", "archived"}:
            raise HTTPException(400, "status không hợp lệ")
        stmt = stmt.where(ZaloTemplate.status == status)
    rows = list((await db.execute(stmt.order_by(ZaloTemplate.updated_at.desc()))).scalars())
    if media_type:
        if media_type not in {"image", "video", "none"}:
            raise HTTPException(400, "media_type không hợp lệ")
        def has_media(template, kind):
            types = {block.get("type") for block in template.content_blocks}
            return ("image_album" in types) if kind == "image" else (kind in types)
        rows = [row for row in rows if (not has_media(row, "image") and not has_media(row, "video"))
                if media_type == "none"] if media_type == "none" else [row for row in rows if has_media(row, media_type)]
    response.headers["X-Total-Count"] = str(len(rows))
    # Keep the existing array response used by the admin client; pagination is
    # still enforced server-side through offset/limit.
    return [_template(x) for x in rows[offset:offset + limit]]


@router.get("/templates/{template_id}", response_model=ZaloTemplateOut, dependencies=[Depends(require_permission("zalo_templates.read"))])
async def get_template(template_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    template = await db.get(ZaloTemplate, template_id)
    if not template: raise HTTPException(404, "Không tìm thấy template")
    return _template(template)


@router.post("/templates", response_model=ZaloTemplateOut, status_code=201, dependencies=[Depends(require_any_permission("zalo_templates.create", "zalo_templates.manage"))])
async def create_template(body: ZaloTemplateCreate, user=Depends(require_any_permission("zalo_templates.create", "zalo_templates.manage")), db: AsyncSession = Depends(get_db)):
    if body.status not in {"draft", "active", "archived"}:
        raise HTTPException(400, "status không hợp lệ")
    try:
        blocks = validate_blocks(await cache_remote_media(body.content_blocks))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    template = ZaloTemplate(**body.model_dump(exclude={"content_blocks"}), content_blocks=blocks, created_by=user.id)
    db.add(template)
    await db.commit(); await db.refresh(template)
    return _template(template)


@router.patch("/templates/{template_id}", response_model=ZaloTemplateOut, dependencies=[Depends(require_any_permission("zalo_templates.edit", "zalo_templates.manage"))])
async def update_template(template_id: uuid.UUID, body: ZaloTemplateUpdate, db: AsyncSession = Depends(get_db)):
    template = await db.get(ZaloTemplate, template_id)
    if not template: raise HTTPException(404, "Không tìm thấy template")
    data = body.model_dump(exclude_unset=True)
    if "content_blocks" in data:
        try: data["content_blocks"] = validate_blocks(await cache_remote_media(data["content_blocks"]))
        except ValueError as exc: raise HTTPException(400, str(exc)) from exc
    if data.get("status") and data["status"] not in {"draft", "active", "archived"}:
        raise HTTPException(400, "status không hợp lệ")
    for key, value in data.items(): setattr(template, key, value)
    template.updated_at = datetime.now(timezone.utc)
    await db.commit(); await db.refresh(template)
    return _template(template)


@router.post("/templates/{template_id}/clone", response_model=ZaloTemplateOut, status_code=201, dependencies=[Depends(require_any_permission("zalo_templates.create", "zalo_templates.manage"))])
async def clone_template(template_id: uuid.UUID, user=Depends(require_any_permission("zalo_templates.create", "zalo_templates.manage")), db: AsyncSession = Depends(get_db)):
    source = await db.get(ZaloTemplate, template_id)
    if not source:
        raise HTTPException(404, "Không tìm thấy template")
    clone = ZaloTemplate(
        name=f"{source.name} (bản sao)",
        description=source.description,
        content_blocks=source.content_blocks,
        status="draft",
        auto_send_new_guest=False,
        auto_send_checkin=False,
        created_by=user.id,
    )
    db.add(clone)
    await db.commit(); await db.refresh(clone)
    return _template(clone)


@router.post("/templates/{template_id}/toggle", response_model=ZaloTemplateOut, dependencies=[Depends(require_any_permission("zalo_templates.edit", "zalo_templates.manage"))])
async def toggle_template(template_id: uuid.UUID, body: ZaloTemplateToggleRequest,
                          db: AsyncSession = Depends(get_db)):
    template = await db.get(ZaloTemplate, template_id)
    if not template:
        raise HTTPException(404, "Không tìm thấy template")
    target = body.status or ("active" if template.status != "active" else "archived")
    if target not in {"active", "archived"}:
        raise HTTPException(400, "toggle chỉ hỗ trợ active hoặc archived")
    template.status = target
    template.updated_at = datetime.now(timezone.utc)
    await db.commit(); await db.refresh(template)
    return _template(template)


@router.delete("/templates/{template_id}", status_code=204, dependencies=[Depends(require_any_permission("zalo_templates.delete", "zalo_templates.manage"))])
async def delete_template(template_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    template = await db.get(ZaloTemplate, template_id)
    if not template: raise HTTPException(404, "Không tìm thấy template")
    template.status = "archived"
    await db.commit()


@router.post("/media", dependencies=[Depends(require_any_permission("zalo_templates.create", "zalo_templates.edit", "zalo_templates.manage"))])
async def upload_media(kind: str, file: UploadFile = File(...)):
    if kind not in {"image", "video", "thumbnail"}: raise HTTPException(400, "kind không hợp lệ")
    return await save_media(file, "image" if kind in {"image", "thumbnail"} else "video")


async def _preflight(body, db, user):
    template = await db.get(ZaloTemplate, body.template_id)
    if not template: raise HTTPException(404, "Không tìm thấy template")
    guests = await _selected_for_user(db, user, body)
    blocks = validate_blocks(template.content_blocks)
    eligible = []
    ineligible = []
    try:
        mappings = await resolve_recipients(db, guests, refresh=body.refresh_recipients)
    except ValueError as exc:
        status_code = 503 if "account_owner_id" in str(exc) else 429
        raise HTTPException(status_code, str(exc)) from exc
    for guest in guests:
        mapping = mappings.get(guest.id)
        detail = {"guest_id": guest.id, "full_name": guest.full_name, "phone": guest.phone}
        if mapping:
            eligible.append({**detail, "recipient_id": mapping.recipient_id,
                             "recipient_name": mapping.recipient_name})
        else:
            ineligible.append({**detail, "reason": "Không tìm thấy recipient Zalo"})
    await db.commit()
    usage = await quota_usage(db, "message")
    remaining = max(0, usage.daily_limit - usage.used_count - usage.reserved_count)
    calls = len(blocks)
    required = calls * len(eligible)
    return {"template_id": template.id, "recipient_count": len(guests),
            "resolved_count": len(eligible), "unresolved_count": len(ineligible),
            "calls_per_guest": calls, "required": required, "remaining": remaining,
            "quota_required": required, "can_send": bool(eligible) and required <= remaining,
            "eligible": eligible, "ineligible": ineligible}


@router.post("/preflight")
async def preflight(body: ZaloPreflightRequest, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    return await _preflight(body, db, user)


@router.get("/quota", dependencies=[Depends(require_permission("zalo_messages.read"))])
async def quota(db: AsyncSession = Depends(get_db)):
    try:
        usage = await quota_usage(db, "message")
    except ValueError as exc:
        raise HTTPException(503, str(exc)) from exc
    await db.commit()
    limit, used, reserved = usage.daily_limit, usage.used_count, usage.reserved_count
    return {"account_owner_id": usage.account_owner_id, "capability": usage.capability,
            "usage_date": usage.usage_date, "daily_limit": limit, "used_count": used,
            "reserved_count": reserved, "available_count": max(0, limit - used - reserved)}


@router.post("/send", response_model=ZaloDeliveryOut, status_code=201)
async def send_one(body: ZaloSendRequest, user=Depends(current_user), db: AsyncSession = Depends(get_db)):
    template = await db.get(ZaloTemplate, body.template_id); guest = await db.get(Guest, body.guest_id)
    if not template or not guest: raise HTTPException(404, "Template hoặc guest không tồn tại")
    if guest.deleted_at is not None: raise HTTPException(404, "Không tìm thấy khách")
    await _authorize_recipients(db, user, [guest])
    if template.status != "active": raise HTTPException(409, "Chỉ gửi được template đang active")
    existing = await db.scalar(select(ZaloDelivery).where(ZaloDelivery.idempotency_key == str(body.idempotency_key)))
    if existing:
        await _authorize_delivery(db, user, existing.id, permission="zalo_messages.send")
        return await _with_item_scopes(db, await _delivery(db, existing.id))
    try: delivery = await create_delivery(db, template, [guest], user.id, idempotency_key=body.idempotency_key)
    except ValueError as exc: await db.rollback(); raise HTTPException(409, str(exc)) from exc
    await _authorize_delivery(db, user, delivery.id, permission="zalo_messages.send")
    await db.commit()
    return await _with_item_scopes(db, await _delivery(db, delivery.id))


@router.post("/batches", response_model=ZaloDeliveryOut, status_code=201)
async def send_batch(body: ZaloBatchSendRequest, user=Depends(current_user), db: AsyncSession = Depends(get_db)):
    template = await db.get(ZaloTemplate, body.template_id)
    if not template: raise HTTPException(404, "Không tìm thấy template")
    if template.status != "active": raise HTTPException(409, "Chỉ gửi được template đang active")
    guests = await _selected_for_user(db, user, body)
    existing = await db.scalar(select(ZaloDelivery).where(ZaloDelivery.idempotency_key == str(body.idempotency_key)))
    if existing:
        await _authorize_delivery(db, user, existing.id, bulk=True)
        return await _with_item_scopes(db, await _delivery(db, existing.id))
    batch = ZaloDeliveryBatch(name=body.name, template_id=template.id,
                              selection={"guest_ids": [str(x) for x in body.guest_ids], "workshop_id": str(body.workshop_id) if body.workshop_id else None},
                              created_by=user.id)
    db.add(batch); await db.flush()
    try: delivery = await create_delivery(db, template, guests, user.id, batch.id, idempotency_key=body.idempotency_key)
    except ValueError as exc: await db.rollback(); raise HTTPException(409, str(exc)) from exc
    await _authorize_delivery(db, user, delivery.id, bulk=True)
    await db.commit()
    return await _with_item_scopes(db, await _delivery(db, delivery.id))


@router.get("/guest-send-statuses", response_model=list[ZaloGuestSendStatusOut])
async def guest_send_statuses(workshop_id: uuid.UUID, template_id: uuid.UUID,
                              db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    await require_workshop_permission(db, user, workshop_id, "zalo_messages.read", "guests.read")
    if not await db.get(Workshop, workshop_id):
        raise HTTPException(404, "Không tìm thấy workshop")
    if not await db.get(ZaloTemplate, template_id):
        raise HTTPException(404, "Không tìm thấy template")

    delivery_guests = select(
        ZaloDeliveryItem.guest_id.label("guest_id"),
        ZaloDelivery.id.label("delivery_id"),
        ZaloDelivery.created_at.label("delivery_created_at"),
    ).join(
        ZaloDelivery, ZaloDelivery.id == ZaloDeliveryItem.delivery_id,
    ).join(
        Guest, Guest.id == ZaloDeliveryItem.guest_id,
    ).where(
        Guest.workshop_id == workshop_id,
        Guest.deleted_at.is_(None),
        ZaloDelivery.template_id == template_id,
        await _visible_deliveries(db, user),
    ).distinct().subquery()
    ranked = select(
        delivery_guests.c.guest_id,
        delivery_guests.c.delivery_id,
        func.row_number().over(
            partition_by=delivery_guests.c.guest_id,
            order_by=(delivery_guests.c.delivery_created_at.desc(), delivery_guests.c.delivery_id.desc()),
        ).label("rank"),
    ).subquery()
    rows = (await db.execute(select(
        ranked.c.guest_id,
        ranked.c.delivery_id,
        ZaloDeliveryItem.status,
        ZaloDeliveryItem.sent_at,
        ZaloDeliveryItem.last_error,
    ).join(
        ZaloDeliveryItem, ZaloDeliveryItem.delivery_id == ranked.c.delivery_id,
    ).where(
        ranked.c.rank == 1,
        ZaloDeliveryItem.guest_id == ranked.c.guest_id,
    ).order_by(ZaloDeliveryItem.block_position))).all()

    grouped: dict[uuid.UUID, dict] = {}
    for guest_id, delivery_id, status, sent_at, last_error in rows:
        item = grouped.setdefault(guest_id, {
            "guest_id": guest_id, "delivery_id": delivery_id,
            "statuses": [], "last_sent_at": None, "last_error": None,
        })
        item["statuses"].append(status)
        if sent_at and (not item["last_sent_at"] or sent_at > item["last_sent_at"]):
            item["last_sent_at"] = sent_at
        if last_error and not item["last_error"]:
            item["last_error"] = last_error
    return [{
        "guest_id": item["guest_id"],
        "delivery_id": item["delivery_id"],
        "status": guest_send_status(item["statuses"]),
        "last_sent_at": item["last_sent_at"],
        "last_error": item["last_error"],
    } for item in grouped.values()]


@router.get("/deliveries", response_model=list[ZaloDeliveryOut])
async def history(guest_id: uuid.UUID | None = None, template_id: uuid.UUID | None = None,
                  offset: int = Query(0, ge=0),
                  limit: int = Query(20, ge=1, le=100), db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    stmt = select(ZaloDelivery).options(selectinload(ZaloDelivery.items))
    stmt = stmt.where(await _visible_deliveries(db, user))
    if guest_id:
        guest = await db.get(Guest, guest_id)
        if not guest: raise HTTPException(404, "Không tìm thấy khách")
        await require_workshop_permission(db, user, guest.workshop_id, "zalo_messages.read")
        item_filter = ZaloDelivery.id.in_(select(ZaloDeliveryItem.delivery_id).where(ZaloDeliveryItem.guest_id == guest_id))
        stmt = stmt.where(item_filter)
    if template_id:
        stmt = stmt.where(ZaloDelivery.template_id == template_id)
    rows = list((await db.execute(stmt.order_by(ZaloDelivery.created_at.desc()).offset(offset).limit(limit))).scalars())
    return [ZaloDeliveryOut.model_validate(await _with_item_scopes(db, row)) for row in rows]


@router.get("/deliveries/{delivery_id}", response_model=ZaloDeliveryOut)
async def detail(delivery_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    row = (await db.execute(select(ZaloDelivery).options(selectinload(ZaloDelivery.items)).where(ZaloDelivery.id == delivery_id))).scalar_one_or_none()
    if not row: raise HTTPException(404, "Không tìm thấy delivery")
    await _authorize_delivery(db, user, row.id)
    return await _with_item_scopes(db, row)


@router.post("/delivery-items/{item_id}/retry", response_model=ZaloDeliveryItemOut)
async def retry(item_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    item = await db.get(ZaloDeliveryItem, item_id)
    if not item: raise HTTPException(404, "Không tìm thấy item")
    await _authorize_delivery(db, user, item.delivery_id, permission="zalo_messages.send")
    if item.status != "failed": raise HTTPException(409, "Chỉ retry item lỗi")
    if not item.recipient_id: raise HTTPException(409, "Cần refresh recipient trước khi retry")
    try: await reopen_quota(db, item.delivery_id, item.quota_cost)
    except ValueError as exc: await db.rollback(); raise HTTPException(409, str(exc)) from exc
    delivery = await db.get(ZaloDelivery, item.delivery_id)
    if delivery and delivery.failed_count:
        delivery.failed_count -= 1
        delivery.status = "queued"
        delivery.completed_at = None
    item.status, item.last_error, item.next_attempt_at = "pending", None, __import__('datetime').datetime.now(__import__('datetime').timezone.utc)
    await db.commit(); await db.refresh(item)
    scoped_guest = await db.get(Guest, item.guest_id) if item.guest_id else None
    item.workshop_id = scoped_guest.workshop_id if scoped_guest else None
    return item


@router.post("/delivery-items/{item_id}/refresh", response_model=ZaloDeliveryItemOut)
async def refresh(item_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    item = await db.get(ZaloDeliveryItem, item_id)
    if not item or not item.guest_id: raise HTTPException(404, "Không tìm thấy item")
    await _authorize_delivery(db, user, item.delivery_id, permission="zalo_messages.send")
    guest = await db.get(Guest, item.guest_id)
    if not guest: raise HTTPException(404, "Không tìm thấy khách")
    mapping = await resolve_recipient(db, guest, refresh=True)
    if not mapping: raise HTTPException(404, "Không resolve được recipient")
    item.recipient_id, item.recipient_name = mapping.recipient_id, mapping.recipient_name
    await db.commit(); await db.refresh(item)
    scoped_guest = await db.get(Guest, item.guest_id) if item.guest_id else None
    item.workshop_id = scoped_guest.workshop_id if scoped_guest else None
    return item
