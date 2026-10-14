import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import case, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import current_user, require_permission
from ..config import settings
from ..auth.workshop_access import WORKSHOP_PERMISSIONS, allowed_workshop_ids, is_global_workshop_admin, require_workshop_permission
from ..db import get_db
from ..models import Guest, Workshop, ZbsDelivery, ZbsTaskConfig, ZbsTemplate
from ..services import zbs_bulk
from ..services.zbs import (
    BULK_TASK_KEY,
    CHECKIN_TASK_KEY,
    CHECKIN_TEMPLATE_ID,
    REGISTRATION_TASK_KEY,
    TASK_DEFINITIONS,
)
from ..services.zbs_auth import ZbsAuthError, oauth_status, refresh_access_token, test_connection

router = APIRouter(prefix="/api", tags=["zbs"])


class ZbsTaskConfigUpdate(BaseModel):
    enabled: bool
    template_id: str | None = None


class ZbsTemplateHiddenUpdate(BaseModel):
    hidden: bool


class ZbsParamMapping(BaseModel):
    source: str
    value: str | None = None


class ZbsBulkRequest(BaseModel):
    template_id: str
    workshop_id: uuid.UUID
    guest_ids: list[uuid.UUID] = Field(min_length=1, max_length=2000)
    params: dict[str, ZbsParamMapping] = {}
    allow_resend: bool = False


class ZbsBulkSendRequest(ZbsBulkRequest):
    bulk_id: uuid.UUID


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
        "hidden": template.hidden,
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


@router.get("/workshops/{workshop_id}/zbs-status")
async def workshop_zbs_status(workshop_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    await require_workshop_permission(db, user, workshop_id, "guests.read")
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


@router.post("/zbs/deliveries/{delivery_id}/retry")
async def retry_delivery(delivery_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    delivery = await db.get(ZbsDelivery, delivery_id)
    if not delivery:
        raise HTTPException(404, "ZBS delivery not found")
    await require_workshop_permission(
        db, user, delivery.workshop_id,
        "zbs.manage" if delivery.event_type == BULK_TASK_KEY else "guests.write",
    )
    if delivery.event_type not in {REGISTRATION_TASK_KEY, CHECKIN_TASK_KEY, BULK_TASK_KEY}:
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


@router.post("/zbs/guests/{guest_id}/send/{task_key}")
async def send_guest_zbs_manually(
    guest_id: uuid.UUID,
    task_key: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(current_user),
):
    guest = await db.get(Guest, guest_id)
    if not guest or guest.deleted_at is not None:
        raise HTTPException(404, "Không tìm thấy khách")
    await require_workshop_permission(db, user, guest.workshop_id, "zbs.manage")
    from ..services.zbs import enqueue_manual
    try:
        delivery = await enqueue_manual(db, guest, task_key)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    await db.commit()
    await db.refresh(delivery)
    return _out(delivery)


@router.get("/zbs/templates", dependencies=[Depends(require_permission("zbs.read"))])
async def list_templates(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    status: str | None = None,
    search: str | None = None,
    include_hidden: bool = False,
    db: AsyncSession = Depends(get_db),
):
    filters = []
    if not include_hidden:
        filters.append(ZbsTemplate.hidden.is_(False))
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
    hidden_count = await db.scalar(select(func.count()).select_from(ZbsTemplate).where(ZbsTemplate.hidden.is_(True))) or 0
    return {
        "data": [_template_out(template) for template in templates],
        "metadata": {
            "total": total, "offset": offset, "limit": limit,
            "last_synced_at": last_synced_at, "hidden_count": hidden_count,
        },
    }


@router.post("/zbs/templates/sync", dependencies=[Depends(require_permission("zbs.manage"))])
async def sync_zbs_templates(db: AsyncSession = Depends(get_db)):
    from ..services.zbs import sync_templates
    try:
        result = await sync_templates(db)
    except ZbsAuthError as exc:
        await db.rollback()
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        await db.rollback()
        raise HTTPException(502, f"Không thể đồng bộ template từ Zalo: {exc}") from exc
    return {**result, "message": f"Đã đồng bộ {result['synced']} template từ Zalo"}


@router.get("/zbs/oauth/status", dependencies=[Depends(require_permission("zbs.read"))])
async def zbs_oauth_status(db: AsyncSession = Depends(get_db)):
    return await oauth_status(db)


@router.post("/zbs/oauth/refresh", dependencies=[Depends(require_permission("zbs.manage"))])
async def zbs_oauth_refresh(db: AsyncSession = Depends(get_db)):
    try:
        await refresh_access_token(db, force=True)
    except ZbsAuthError as exc:
        await db.rollback()
        raise HTTPException(503, str(exc)) from exc
    return await oauth_status(db)


@router.post("/zbs/oauth/test", dependencies=[Depends(require_permission("zbs.manage"))])
async def zbs_oauth_test(db: AsyncSession = Depends(get_db)):
    try:
        return await test_connection(db)
    except ZbsAuthError as exc:
        await db.rollback()
        raise HTTPException(503, str(exc)) from exc


@router.get("/zbs/templates/{template_id}", dependencies=[Depends(require_permission("zbs.read"))])
async def get_template(template_id: str, db: AsyncSession = Depends(get_db)):
    template = await db.get(ZbsTemplate, template_id)
    if template is None:
        raise HTTPException(404, "Không tìm thấy template")
    return _template_out(template, include_detail=True)


@router.put("/zbs/templates/{template_id}/hidden", dependencies=[Depends(require_permission("zbs.manage"))])
async def set_template_hidden(template_id: str, body: ZbsTemplateHiddenUpdate, db: AsyncSession = Depends(get_db)):
    template = await db.get(ZbsTemplate, template_id)
    if template is None:
        raise HTTPException(404, "Không tìm thấy template")
    if body.hidden:
        in_use = (await db.execute(select(ZbsTaskConfig.task_label).where(
            ZbsTaskConfig.template_id == template_id, ZbsTaskConfig.enabled.is_(True),
        ))).scalars().all()
        if in_use:
            raise HTTPException(409, f"Mẫu tin đang dùng cho tác vụ tự động: {', '.join(in_use)}")
    template.hidden = body.hidden
    template.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(template)
    return _template_out(template)


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
        if body.enabled and template.hidden:
            raise HTTPException(400, "Mẫu tin đang bị ẩn")
        if body.enabled and template.status != "ENABLE":
            raise HTTPException(400, "Chỉ có thể gửi tự động bằng template đã kích hoạt")
    config = (await _task_configs(db))[task_key]
    config.enabled = body.enabled
    config.template_id = template_id
    config.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(config)
    return await _task_config_out(config, db)


BULK_STATUSES = ("pending", "sending", "sent", "delivered", "failed", "expired", "cancelled")


def _bulk_id_column():
    return ZbsDelivery.payload["bulk_id"].astext


def _price(template: ZbsTemplate) -> float | None:
    try:
        return float(template.price_sdt) if template.price_sdt not in (None, "") else None
    except (TypeError, ValueError):
        return None


async def _bulk_context(db: AsyncSession, user, body: ZbsBulkRequest):
    await require_workshop_permission(db, user, body.workshop_id, "guests.read", "zbs.manage")
    workshop = await db.get(Workshop, body.workshop_id)
    if workshop is None:
        raise HTTPException(404, "Không tìm thấy workshop")
    template = await db.get(ZbsTemplate, body.template_id)
    if template is None:
        raise HTTPException(404, "Không tìm thấy mẫu tin")
    if template.status != "ENABLE" or template.hidden:
        raise HTTPException(409, "Chỉ gửi được mẫu tin đã kích hoạt và không bị ẩn")
    guest_ids = list(dict.fromkeys(body.guest_ids))
    guests = list((await db.execute(select(Guest).where(
        Guest.id.in_(guest_ids),
        Guest.workshop_id == workshop.id,
        Guest.deleted_at.is_(None),
    ))).scalars().all())
    if len(guests) != len(guest_ids):
        raise HTTPException(404, "Không tìm thấy đủ khách đã chọn trong workshop")
    order = {guest_id: index for index, guest_id in enumerate(guest_ids)}
    guests.sort(key=lambda guest: order[guest.id])
    params = zbs_bulk.template_params(template)
    mapping = {
        **zbs_bulk.default_mapping(params),
        **{name: entry.model_dump() for name, entry in body.params.items()},
    }
    return workshop, template, guests, params, mapping, zbs_bulk.validate_mapping(params, mapping)


async def _bulk_summary(db: AsyncSession, bulk_id: str, include_items: bool = False) -> dict:
    deliveries = (await db.execute(
        select(ZbsDelivery, Guest.full_name)
        .outerjoin(Guest, Guest.id == ZbsDelivery.guest_id)
        .where(ZbsDelivery.event_type == BULK_TASK_KEY, _bulk_id_column() == bulk_id)
        .order_by(ZbsDelivery.created_at, Guest.full_name)
    )).all()
    if not deliveries:
        raise HTTPException(404, "Không tìm thấy lượt gửi")
    first = deliveries[0][0]
    template = await db.get(ZbsTemplate, first.template_id) if first.template_id else None
    workshop = await db.get(Workshop, first.workshop_id)
    counts = {status: 0 for status in BULK_STATUSES}
    for delivery, _ in deliveries:
        counts[delivery.status] = counts.get(delivery.status, 0) + 1
    result = {
        "bulk_id": bulk_id,
        "template_id": first.template_id,
        "template_name": template.template_name if template else None,
        "workshop_id": str(first.workshop_id),
        "workshop_name": workshop.name if workshop else None,
        "created_at": first.created_at,
        "created_by_name": first.payload.get("created_by_name"),
        "total": len(deliveries),
        "counts": counts,
    }
    if include_items:
        result["items"] = [{**_out(delivery), "guest_id": str(delivery.guest_id), "full_name": full_name}
                           for delivery, full_name in deliveries]
    return result


@router.get("/zbs/bulk/options")
async def bulk_options(user=Depends(current_user)):
    return {
        "sources": [{"key": key, "label": label} for key, label in zbs_bulk.PARAM_SOURCES.items()],
        "default_sources": zbs_bulk.DEFAULT_SOURCES,
        "system_enabled": settings.ZBS_ENABLED,
    }


@router.post("/zbs/bulk/preflight")
async def bulk_preflight(body: ZbsBulkRequest, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    workshop, template, guests, _, mapping, mapping_errors = await _bulk_context(db, user, body)
    recipients = await zbs_bulk.evaluate_recipients(db, template, workshop, guests, mapping, body.allow_resend)
    eligible = [item for item in recipients if item["eligible"]]
    price = _price(template)
    return {
        "total": len(recipients),
        "eligible_count": len(eligible),
        "ineligible_count": len(recipients) - len(eligible),
        "eligible_guest_ids": [str(item["guest_id"]) for item in eligible],
        "mapping_errors": mapping_errors,
        "system_enabled": settings.ZBS_ENABLED,
        "price_per_message": price,
        "estimated_cost": price * len(eligible) if price is not None else None,
        "can_send": settings.ZBS_ENABLED and not mapping_errors and bool(eligible),
        "recipients": [{**item, "guest_id": str(item["guest_id"])} for item in recipients],
    }


@router.post("/zbs/bulk/send", status_code=201)
async def bulk_send(body: ZbsBulkSendRequest, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    workshop, template, guests, _, mapping, mapping_errors = await _bulk_context(db, user, body)
    bulk_id = str(body.bulk_id)
    existing = await db.scalar(select(ZbsDelivery.id).where(
        ZbsDelivery.event_type == BULK_TASK_KEY, _bulk_id_column() == bulk_id,
    ).limit(1))
    if existing:
        return await _bulk_summary(db, bulk_id)
    if not settings.ZBS_ENABLED:
        raise HTTPException(409, "ZBS đang bị tắt ở cấu hình hệ thống")
    if mapping_errors:
        raise HTTPException(400, "; ".join(mapping_errors))
    recipients = await zbs_bulk.evaluate_recipients(db, template, workshop, guests, mapping, body.allow_resend)
    eligible = [item for item in recipients if item["eligible"]]
    if not eligible:
        raise HTTPException(409, "Không có khách đủ điều kiện để gửi")
    zbs_bulk.enqueue_bulk(db, template, workshop, eligible, body.bulk_id, user)
    try:
        await db.commit()
    except IntegrityError:
        # Một yêu cầu khác cùng bulk_id đã xếp hàng trước.
        await db.rollback()
    summary = await _bulk_summary(db, bulk_id)
    summary["skipped"] = [
        {"guest_id": str(item["guest_id"]), "full_name": item["full_name"], "reason": item["reason"]}
        for item in recipients if not item["eligible"]
    ]
    return summary


@router.get("/zbs/bulk/statuses")
async def bulk_statuses(
    workshop_id: uuid.UUID,
    template_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(current_user),
):
    await require_workshop_permission(db, user, workshop_id, "guests.read", "zbs.read")
    guest_ids = list((await db.execute(select(Guest.id).where(
        Guest.workshop_id == workshop_id, Guest.deleted_at.is_(None),
    ))).scalars().all())
    latest = await zbs_bulk.previous_bulk_statuses(db, template_id, guest_ids)
    return {
        str(guest_id): {**_out(delivery), "bulk_id": delivery.payload.get("bulk_id")}
        for guest_id, delivery in latest.items()
    }


@router.get("/zbs/bulk/batches")
async def bulk_batches(
    workshop_id: uuid.UUID | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user=Depends(current_user),
):
    filters = [ZbsDelivery.event_type == BULK_TASK_KEY]
    if workshop_id:
        await require_workshop_permission(db, user, workshop_id, "zbs.read")
        filters.append(ZbsDelivery.workshop_id == workshop_id)
    else:
        allowed = await allowed_workshop_ids(db, user, "zbs.read")
        if allowed is not None:
            filters.append(ZbsDelivery.workshop_id.in_(allowed))
    bulk_id = _bulk_id_column()
    created_at = func.min(ZbsDelivery.created_at)
    rows = (await db.execute(
        select(
            bulk_id,
            ZbsDelivery.template_id,
            ZbsDelivery.workshop_id,
            created_at,
            func.max(ZbsDelivery.payload["created_by_name"].astext),
            func.count(),
            *[func.count(case((ZbsDelivery.status == status, 1))) for status in BULK_STATUSES],
        )
        .where(*filters)
        .group_by(bulk_id, ZbsDelivery.template_id, ZbsDelivery.workshop_id)
        .order_by(created_at.desc())
        .limit(limit)
    )).all()
    template_ids = {row[1] for row in rows if row[1]}
    workshop_ids = {row[2] for row in rows}
    template_names = dict((await db.execute(
        select(ZbsTemplate.template_id, ZbsTemplate.template_name).where(ZbsTemplate.template_id.in_(template_ids))
    )).all()) if template_ids else {}
    workshop_names = dict((await db.execute(
        select(Workshop.id, Workshop.name).where(Workshop.id.in_(workshop_ids))
    )).all()) if workshop_ids else {}
    return [{
        "bulk_id": row[0],
        "template_id": row[1],
        "template_name": template_names.get(row[1]),
        "workshop_id": str(row[2]),
        "workshop_name": workshop_names.get(row[2]),
        "created_at": row[3],
        "created_by_name": row[4],
        "total": row[5],
        "counts": dict(zip(BULK_STATUSES, row[6:])),
    } for row in rows]


async def _bulk_workshop(db: AsyncSession, bulk_id: uuid.UUID) -> uuid.UUID:
    workshop_id = await db.scalar(select(ZbsDelivery.workshop_id).where(
        ZbsDelivery.event_type == BULK_TASK_KEY, _bulk_id_column() == str(bulk_id),
    ).limit(1))
    if workshop_id is None:
        raise HTTPException(404, "Không tìm thấy lượt gửi")
    return workshop_id


@router.get("/zbs/bulk/batches/{bulk_id}")
async def bulk_batch_detail(bulk_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    await require_workshop_permission(db, user, await _bulk_workshop(db, bulk_id), "guests.read", "zbs.read")
    return await _bulk_summary(db, str(bulk_id), include_items=True)


@router.post("/zbs/bulk/batches/{bulk_id}/retry-failed")
async def bulk_retry_failed(bulk_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    await require_workshop_permission(db, user, await _bulk_workshop(db, bulk_id), "zbs.manage")
    if not settings.ZBS_ENABLED:
        raise HTTPException(409, "ZBS đang bị tắt ở cấu hình hệ thống")
    from ..services.zbs import _expiry
    now = datetime.now(timezone.utc)
    failed = (await db.execute(select(ZbsDelivery).where(
        ZbsDelivery.event_type == BULK_TASK_KEY,
        _bulk_id_column() == str(bulk_id),
        ZbsDelivery.status == "failed",
    ))).scalars().all()
    for delivery in failed:
        expires_at = _expiry(delivery)
        if expires_at and now > expires_at:
            delivery.status = "expired"
            delivery.last_error = "Quá thời hạn 7 ngày kể từ lúc phát sinh tác vụ"
        else:
            delivery.status = "pending"
            delivery.next_attempt_at = now
            delivery.last_error = None
        delivery.updated_at = now
    await db.commit()
    return await _bulk_summary(db, str(bulk_id), include_items=True)


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
