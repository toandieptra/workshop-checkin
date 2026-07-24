import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth.dependencies import require_permission
from ..db import get_db
from ..models import Guest, ZaloDelivery, ZaloDeliveryBatch, ZaloDeliveryItem, ZaloTemplate
from ..schemas import (ZaloBatchSendRequest, ZaloDeliveryItemOut, ZaloDeliveryOut,
                       ZaloPreflightRequest, ZaloSendRequest, ZaloTemplateCreate,
                       ZaloTemplateOut, ZaloTemplateToggleRequest, ZaloTemplateUpdate)
from ..services.zalo_messages import (cache_remote_media, create_delivery, quota_usage,
                                         reopen_quota, resolve_recipient, save_media,
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


@router.post("/templates", response_model=ZaloTemplateOut, status_code=201, dependencies=[Depends(require_permission("zalo_templates.manage"))])
async def create_template(body: ZaloTemplateCreate, user=Depends(require_permission("zalo_templates.manage")), db: AsyncSession = Depends(get_db)):
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


@router.patch("/templates/{template_id}", response_model=ZaloTemplateOut, dependencies=[Depends(require_permission("zalo_templates.manage"))])
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


@router.post("/templates/{template_id}/clone", response_model=ZaloTemplateOut, status_code=201, dependencies=[Depends(require_permission("zalo_templates.manage"))])
async def clone_template(template_id: uuid.UUID, user=Depends(require_permission("zalo_templates.manage")), db: AsyncSession = Depends(get_db)):
    source = await db.get(ZaloTemplate, template_id)
    if not source:
        raise HTTPException(404, "Không tìm thấy template")
    clone = ZaloTemplate(name=f"{source.name} (bản sao)", description=source.description,
                         content_blocks=source.content_blocks, status="draft", created_by=user.id)
    db.add(clone)
    await db.commit(); await db.refresh(clone)
    return _template(clone)


@router.post("/templates/{template_id}/toggle", response_model=ZaloTemplateOut, dependencies=[Depends(require_permission("zalo_templates.manage"))])
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


@router.delete("/templates/{template_id}", status_code=204, dependencies=[Depends(require_permission("zalo_templates.manage"))])
async def delete_template(template_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    template = await db.get(ZaloTemplate, template_id)
    if not template: raise HTTPException(404, "Không tìm thấy template")
    template.status = "archived"
    await db.commit()


@router.post("/media", dependencies=[Depends(require_permission("zalo_templates.manage"))])
async def upload_media(kind: str, file: UploadFile = File(...)):
    if kind not in {"image", "video", "thumbnail"}: raise HTTPException(400, "kind không hợp lệ")
    return await save_media(file, "image" if kind in {"image", "thumbnail"} else "video")


async def _preflight(body, db):
    template = await db.get(ZaloTemplate, body.template_id)
    if not template: raise HTTPException(404, "Không tìm thấy template")
    guests = await selected_guests(db, body.guest_ids, body.workshop_id)
    blocks = validate_blocks(template.content_blocks)
    eligible = []
    ineligible = []
    for guest in guests:
        try:
            mapping = await resolve_recipient(db, guest, refresh=body.refresh_recipients)
        except ValueError as exc:
            raise HTTPException(429, str(exc)) from exc
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


@router.post("/preflight", dependencies=[Depends(require_permission("zalo_messages.send")), Depends(require_permission("guests.read"))])
async def preflight(body: ZaloPreflightRequest, db: AsyncSession = Depends(get_db)):
    return await _preflight(body, db)


@router.get("/quota", dependencies=[Depends(require_permission("zalo_messages.read"))])
async def quota(db: AsyncSession = Depends(get_db)):
    usage = await quota_usage(db, "message")
    await db.commit()
    limit, used, reserved = usage.daily_limit, usage.used_count, usage.reserved_count
    return {"account_owner_id": usage.account_owner_id, "capability": usage.capability,
            "usage_date": usage.usage_date, "daily_limit": limit, "used_count": used,
            "reserved_count": reserved, "available_count": max(0, limit - used - reserved)}


@router.post("/send", response_model=ZaloDeliveryOut, status_code=201, dependencies=[Depends(require_permission("zalo_messages.send"))])
async def send_one(body: ZaloSendRequest, user=Depends(require_permission("zalo_messages.send")), db: AsyncSession = Depends(get_db)):
    template = await db.get(ZaloTemplate, body.template_id); guest = await db.get(Guest, body.guest_id)
    if not template or not guest: raise HTTPException(404, "Template hoặc guest không tồn tại")
    if template.status != "active": raise HTTPException(409, "Chỉ gửi được template đang active")
    existing = await db.scalar(select(ZaloDelivery).where(ZaloDelivery.idempotency_key == str(body.idempotency_key)))
    if existing:
        return await _delivery(db, existing.id)
    try: delivery = await create_delivery(db, template, [guest], user.id, idempotency_key=body.idempotency_key)
    except ValueError as exc: await db.rollback(); raise HTTPException(409, str(exc)) from exc
    await db.commit()
    return await _delivery(db, delivery.id)


@router.post("/batches", response_model=ZaloDeliveryOut, status_code=201, dependencies=[Depends(require_permission("zalo_messages.send")), Depends(require_permission("guests.read"))])
async def send_batch(body: ZaloBatchSendRequest, user=Depends(require_permission("zalo_messages.send")), db: AsyncSession = Depends(get_db)):
    template = await db.get(ZaloTemplate, body.template_id)
    if not template: raise HTTPException(404, "Không tìm thấy template")
    if template.status != "active": raise HTTPException(409, "Chỉ gửi được template đang active")
    guests = await selected_guests(db, body.guest_ids, body.workshop_id)
    existing = await db.scalar(select(ZaloDelivery).where(ZaloDelivery.idempotency_key == str(body.idempotency_key)))
    if existing:
        return await _delivery(db, existing.id)
    batch = ZaloDeliveryBatch(name=body.name, template_id=template.id,
                              selection={"guest_ids": [str(x) for x in body.guest_ids], "workshop_id": str(body.workshop_id) if body.workshop_id else None},
                              created_by=user.id)
    db.add(batch); await db.flush()
    try: delivery = await create_delivery(db, template, guests, user.id, batch.id, idempotency_key=body.idempotency_key)
    except ValueError as exc: await db.rollback(); raise HTTPException(409, str(exc)) from exc
    await db.commit()
    return await _delivery(db, delivery.id)


@router.get("/deliveries", response_model=list[ZaloDeliveryOut], dependencies=[Depends(require_permission("zalo_messages.read"))])
async def history(guest_id: uuid.UUID | None = None, template_id: uuid.UUID | None = None,
                  offset: int = Query(0, ge=0),
                  limit: int = Query(20, ge=1, le=100), db: AsyncSession = Depends(get_db)):
    stmt = select(ZaloDelivery).options(selectinload(ZaloDelivery.items))
    count_stmt = select(func.count(ZaloDelivery.id))
    if guest_id:
        item_filter = ZaloDelivery.id.in_(select(ZaloDeliveryItem.delivery_id).where(ZaloDeliveryItem.guest_id == guest_id))
        stmt = stmt.where(item_filter)
        count_stmt = count_stmt.where(item_filter)
    if template_id:
        stmt = stmt.where(ZaloDelivery.template_id == template_id)
        count_stmt = count_stmt.where(ZaloDelivery.template_id == template_id)
    total = int(await db.scalar(count_stmt) or 0)
    rows = list((await db.execute(stmt.order_by(ZaloDelivery.created_at.desc()).offset(offset).limit(limit))).scalars())
    return [ZaloDeliveryOut.model_validate(row) for row in rows]


@router.get("/deliveries/{delivery_id}", response_model=ZaloDeliveryOut, dependencies=[Depends(require_permission("zalo_messages.read"))])
async def detail(delivery_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(ZaloDelivery).options(selectinload(ZaloDelivery.items)).where(ZaloDelivery.id == delivery_id))).scalar_one_or_none()
    if not row: raise HTTPException(404, "Không tìm thấy delivery")
    return row


@router.post("/delivery-items/{item_id}/retry", response_model=ZaloDeliveryItemOut, dependencies=[Depends(require_permission("zalo_messages.send"))])
async def retry(item_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    item = await db.get(ZaloDeliveryItem, item_id)
    if not item: raise HTTPException(404, "Không tìm thấy item")
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
    await db.commit(); await db.refresh(item); return item


@router.post("/delivery-items/{item_id}/refresh", response_model=ZaloDeliveryItemOut, dependencies=[Depends(require_permission("zalo_messages.send"))])
async def refresh(item_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    item = await db.get(ZaloDeliveryItem, item_id)
    if not item or not item.guest_id: raise HTTPException(404, "Không tìm thấy item")
    guest = await db.get(Guest, item.guest_id); mapping = await resolve_recipient(db, guest, refresh=True)
    if not mapping: raise HTTPException(404, "Không resolve được recipient")
    item.recipient_id, item.recipient_name = mapping.recipient_id, mapping.recipient_name
    await db.commit(); await db.refresh(item); return item
