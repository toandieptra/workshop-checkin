import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import require_permission
from ..config import settings
from ..db import get_db
from ..models import Guest, ZbsDelivery, ZbsTaskConfig, ZbsTemplate
from ..services.zbs import (
    CHECKIN_TASK_KEY,
    CHECKIN_TEMPLATE_ID,
    REGISTRATION_TASK_KEY,
    TASK_DEFINITIONS,
)

router = APIRouter(prefix="/api", tags=["zbs"])


class ZbsTaskConfigUpdate(BaseModel):
    enabled: bool
    template_id: str | None = None


def _template_out(template: ZbsTemplate, include_detail: bool = False) -> dict:
    result = {
        "template_id": template.template_id,
        "template_name": template.template_name,
        "status": template.status,
        "quality": template.quality,
        "tag": template.tag,
        "template_type": template.template_type,
        "preview_url": template.preview_url,
        "price_sdt": template.price_sdt,
        "price_uid": template.price_uid,
        "zalo_created_at": template.zalo_created_at,
        "synced_at": template.synced_at,
    }
    if include_detail:
        result["detail"] = template.detail or {}
    return result


async def _task_configs(db: AsyncSession) -> dict[str, ZbsTaskConfig]:
    configs: dict[str, ZbsTaskConfig] = {}
    for task_key, task_label in TASK_DEFINITIONS:
        config = await db.get(ZbsTaskConfig, task_key)
        if config is None:
            default_template = (
                CHECKIN_TEMPLATE_ID if task_key == CHECKIN_TASK_KEY else settings.ZBS_REGISTRATION_TEMPLATE_ID
            )
            config = ZbsTaskConfig(
                task_key=task_key,
                task_label=task_label,
                enabled=False,
                template_id=default_template,
            )
            db.add(config)
        configs[task_key] = config
    if any(config in db.new for config in configs.values()):
        await db.commit()
        for config in configs.values():
            await db.refresh(config)
    return configs


async def _task_config_out(config: ZbsTaskConfig, db: AsyncSession) -> dict:
    template = await db.get(ZbsTemplate, config.template_id) if config.template_id else None
    return {
        "task_key": config.task_key,
        "task_label": config.task_label,
        "enabled": config.enabled,
        "template_id": config.template_id,
        "template_name": template.template_name if template else None,
        "template_status": template.status if template else None,
        "updated_at": config.updated_at,
        "system_enabled": settings.ZBS_ENABLED,
    }


def _out(delivery: ZbsDelivery) -> dict:
    return {
        "id": str(delivery.id),
        "event_type": delivery.event_type,
        "status": delivery.status,
        "phone": delivery.phone,
        "attempt_count": delivery.attempt_count,
        "msg_id": delivery.msg_id,
        "last_error": delivery.last_error,
        "sent_time": delivery.sent_time,
        "delivery_time": delivery.delivery_time,
        "updated_at": delivery.updated_at,
    }


@router.get("/workshops/{workshop_id}/zbs-status", dependencies=[Depends(require_permission("guests.read"))])
async def workshop_zbs_status(workshop_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    deliveries = (await db.execute(
        select(ZbsDelivery)
        .where(
            ZbsDelivery.workshop_id == workshop_id,
            ZbsDelivery.event_type.in_([REGISTRATION_TASK_KEY, CHECKIN_TASK_KEY]),
        )
        .order_by(ZbsDelivery.created_at.desc())
    )).scalars().all()
    result: dict[str, dict] = {}
    for delivery in deliveries:
        guest = result.setdefault(str(delivery.guest_id), {})
        if delivery.event_type not in guest:
            guest[delivery.event_type] = _out(delivery)
    return result


@router.post("/zbs/deliveries/{delivery_id}/retry", dependencies=[Depends(require_permission("guests.write"))])
async def retry_delivery(delivery_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    delivery = await db.get(ZbsDelivery, delivery_id)
    if not delivery:
        raise HTTPException(404, "ZBS delivery not found")
    if delivery.event_type not in {REGISTRATION_TASK_KEY, CHECKIN_TASK_KEY}:
        raise HTTPException(409, "Tác vụ ZBS không hỗ trợ gửi lại")
    task_config = await db.get(ZbsTaskConfig, delivery.event_type)
    if task_config and not task_config.enabled:
        raise HTTPException(409, "Tác vụ ZBS đang bị tắt")
    if delivery.status != "failed":
        raise HTTPException(409, "Chỉ có thể gửi lại tin lỗi")
    guest = await db.get(Guest, delivery.guest_id)
    if not guest:
        raise HTTPException(404, "guest not found")
    from ..services.zbs import _expiry, normalize_phone, zbs_phone
    phone = normalize_phone(guest.phone)
    if not phone:
        raise HTTPException(400, "Khách chưa có số điện thoại hợp lệ")
    expires_at = _expiry(delivery)
    if expires_at and datetime.now(timezone.utc) > expires_at:
        delivery.status = "expired"
        delivery.last_error = "Quá thời hạn 7 ngày kể từ lúc phát sinh tác vụ"
        delivery.updated_at = datetime.now(timezone.utc)
        await db.commit()
        raise HTTPException(409, delivery.last_error)
    delivery.phone = phone
    template_data = dict(delivery.payload.get("template_data") or {})
    if delivery.event_type == REGISTRATION_TASK_KEY:
        template_data["customer_phone"] = zbs_phone(phone)
    delivery.payload = {**delivery.payload, "template_data": template_data}
    delivery.status = "pending"
    delivery.next_attempt_at = datetime.now(timezone.utc)
    delivery.last_error = None
    delivery.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(delivery)
    return _out(delivery)


@router.get("/zbs/templates", dependencies=[Depends(require_permission("zbs.read"))])
async def list_templates(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    status: str | None = None,
    search: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    filters = []
    if status:
        filters.append(ZbsTemplate.status == status)
    if search and search.strip():
        term = f"%{search.strip()}%"
        filters.append(or_(
            ZbsTemplate.template_name.ilike(term),
            ZbsTemplate.template_id.ilike(term),
        ))
    total = await db.scalar(select(func.count()).select_from(ZbsTemplate).where(*filters)) or 0
    templates = (await db.execute(
        select(ZbsTemplate)
        .where(*filters)
        .order_by(ZbsTemplate.zalo_created_at.desc().nulls_last(), ZbsTemplate.template_id.desc())
        .offset(offset)
        .limit(limit)
    )).scalars().all()
    last_synced_at = await db.scalar(select(func.max(ZbsTemplate.synced_at)))
    return {
        "data": [_template_out(template) for template in templates],
        "metadata": {"total": total, "offset": offset, "limit": limit, "last_synced_at": last_synced_at},
    }


@router.post("/zbs/templates/sync", dependencies=[Depends(require_permission("zbs.manage"))])
async def sync_zbs_templates(db: AsyncSession = Depends(get_db)):
    from ..services.zbs import sync_templates
    try:
        result = await sync_templates(db)
    except Exception as exc:
        await db.rollback()
        raise HTTPException(502, f"Không thể đồng bộ template từ Zalo: {exc}") from exc
    return {**result, "message": f"Đã đồng bộ {result['synced']} template từ Zalo"}


@router.get("/zbs/templates/{template_id}", dependencies=[Depends(require_permission("zbs.read"))])
async def get_template(template_id: str, db: AsyncSession = Depends(get_db)):
    template = await db.get(ZbsTemplate, template_id)
    if template is None:
        raise HTTPException(404, "Không tìm thấy template")
    return _template_out(template, include_detail=True)


@router.get("/zbs/task-configs", dependencies=[Depends(require_permission("zbs.read"))])
async def list_task_configs(db: AsyncSession = Depends(get_db)):
    return [await _task_config_out(config, db) for config in (await _task_configs(db)).values()]


@router.put("/zbs/task-configs/{task_key}", dependencies=[Depends(require_permission("zbs.manage"))])
async def update_task_config(
    task_key: str,
    body: ZbsTaskConfigUpdate,
    db: AsyncSession = Depends(get_db),
):
    if task_key not in {REGISTRATION_TASK_KEY, CHECKIN_TASK_KEY}:
        raise HTTPException(404, "Tác vụ ZBS không tồn tại")
    template_id = (body.template_id or "").strip() or None
    if body.enabled and not settings.ZBS_ENABLED:
        raise HTTPException(409, "ZBS đang bị tắt ở cấu hình hệ thống")
    if body.enabled and not template_id:
        raise HTTPException(400, "Vui lòng chọn template trước khi bật tự động gửi")
    if template_id:
        template = await db.get(ZbsTemplate, template_id)
        if template is None:
            raise HTTPException(400, "Template chưa có trong dữ liệu đồng bộ")
        if body.enabled and template.status != "ENABLE":
            raise HTTPException(400, "Chỉ có thể gửi tự động bằng template đã kích hoạt")
    config = (await _task_configs(db))[task_key]
    config.enabled = body.enabled
    config.template_id = template_id
    config.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(config)
    return await _task_config_out(config, db)


@router.post("/webhooks/zbs")
async def zbs_webhook(
    body: dict,
    db: AsyncSession = Depends(get_db),
    x_zbs_webhook_secret: str | None = Header(default=None),
):
    if settings.ZBS_WEBHOOK_SECRET and x_zbs_webhook_secret != settings.ZBS_WEBHOOK_SECRET:
        raise HTTPException(401, "invalid webhook secret")
    tracking_id = body.get("tracking_id")
    msg_id = body.get("msg_id")
    delivery = None
    if tracking_id:
        try:
            delivery = await db.get(ZbsDelivery, uuid.UUID(str(tracking_id)))
        except ValueError:
            pass
    if not delivery and msg_id:
        delivery = await db.scalar(select(ZbsDelivery).where(ZbsDelivery.msg_id == str(msg_id)))
    if not delivery:
        return {"received": True}
    timestamp = body.get("delivery_time") or body.get("timestamp")
    try:
        value = float(timestamp)
        if value > 10_000_000_000:
            value /= 1000
        delivery.delivery_time = datetime.fromtimestamp(value, timezone.utc)
    except (TypeError, ValueError, OSError):
        delivery.delivery_time = datetime.now(timezone.utc)
    delivery.status = "delivered"
    delivery.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"received": True}
