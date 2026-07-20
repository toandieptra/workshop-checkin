import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import require_permission
from ..config import settings
from ..db import get_db
from ..models import Guest, ZbsDelivery

router = APIRouter(prefix="/api", tags=["zbs"])


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
            ZbsDelivery.event_type == "registration_confirmation",
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
    if delivery.event_type != "registration_confirmation":
        raise HTTPException(409, "Chỉ hỗ trợ gửi lại xác nhận đăng ký")
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
        delivery.last_error = "Quá thời hạn 7 ngày kể từ lúc đăng ký"
        delivery.updated_at = datetime.now(timezone.utc)
        await db.commit()
        raise HTTPException(409, delivery.last_error)
    delivery.phone = phone
    template_data = dict(delivery.payload.get("template_data") or {})
    template_data["customer_phone"] = zbs_phone(phone)
    delivery.payload = {**delivery.payload, "template_data": template_data}
    delivery.status = "pending"
    delivery.next_attempt_at = datetime.now(timezone.utc)
    delivery.last_error = None
    delivery.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(delivery)
    return _out(delivery)


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
