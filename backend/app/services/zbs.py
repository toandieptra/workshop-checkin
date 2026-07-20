import logging
import asyncio
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import Guest, Workshop, ZbsDelivery

logger = logging.getLogger("zbs")


def normalize_phone(phone: str | None) -> str:
    digits = "".join(c for c in (phone or "") if c.isdigit())
    if digits.startswith("84") and len(digits) >= 11:
        digits = "0" + digits[2:]
    return digits


def zbs_phone(phone: str | None) -> str:
    normalized = normalize_phone(phone)
    return "84" + normalized[1:] if normalized.startswith("0") else normalized


def _workshop_time(workshop: Workshop) -> str:
    if not workshop.event_date:
        return ""
    date_value = workshop.event_date.strftime("%d/%m/%Y")
    if not workshop.event_time:
        return date_value
    # Zalo template accepts "HH:MM DD/MM/YYYY", not "DD/MM/YYYY HH:MM".
    return f"{workshop.event_time.strftime('%H:%M')} {date_value}"


def _clip(value: str | None, limit: int) -> str:
    text = (value or "").strip()
    return text if len(text) <= limit else text[:limit]


def _registered_at(guest: Guest) -> datetime:
    value = guest.registered_at or guest.created_at or datetime.now(timezone.utc)
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _template_data(guest: Guest, workshop: Workshop, phone: str) -> dict:
    return {
        "customer_name": _clip(guest.full_name, 30),
        "workshop": _clip(workshop.name, 30),
        "customer_phone": zbs_phone(phone),
        "workshop_address": _clip(workshop.location, 200),
        "workshop_time": _workshop_time(workshop),
        "customer_qty": int(guest.party_size or 1),
    }


async def enqueue_registration(db: AsyncSession, guest: Guest, old_phone: str | None = None) -> None:
    phone = normalize_phone(guest.phone)
    if old_phone is not None and normalize_phone(old_phone) == phone:
        return
    previous = (await db.execute(select(ZbsDelivery).where(
        ZbsDelivery.guest_id == guest.id,
        ZbsDelivery.event_type == "registration_confirmation",
    ).order_by(ZbsDelivery.created_at.desc()))).scalars().all()
    if old_phone is not None and any(item.status in ("sent", "delivered", "sending") for item in previous):
        return
    event_key = f"registration_confirmation:{guest.id}:{phone}"
    if any(item.event_key == event_key for item in previous):
        return
    if old_phone is not None:
        await db.execute(update(ZbsDelivery).where(
            ZbsDelivery.guest_id == guest.id,
            ZbsDelivery.event_type == "registration_confirmation",
            ZbsDelivery.phone == normalize_phone(old_phone),
            ZbsDelivery.status.in_(["pending", "failed"]),
        ).values(status="cancelled", updated_at=datetime.now(timezone.utc)))
    workshop = await db.get(Workshop, guest.workshop_id)
    if not workshop:
        return
    registered_at = _registered_at(guest)
    db.add(ZbsDelivery(
        guest_id=guest.id, workshop_id=guest.workshop_id,
        event_type="registration_confirmation", event_key=event_key,
        phone=phone or None, template_id=settings.ZBS_REGISTRATION_TEMPLATE_ID,
        payload={
            "template_data": _template_data(guest, workshop, phone),
            "registered_at": registered_at.isoformat(),
        },
        status="expired" if datetime.now(timezone.utc) > registered_at + timedelta(days=7) else "pending",
    ))


def _retryable(status: int, error: int | None) -> bool:
    return status >= 500 or status in (408, 429) or error in (1001, 1002, 1003)


def _expiry(delivery: ZbsDelivery) -> datetime | None:
    try:
        value = datetime.fromisoformat(delivery.payload.get("registered_at", ""))
        value = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return value + timedelta(days=7)
    except (TypeError, ValueError):
        return None


def _payload_error(delivery: ZbsDelivery) -> str | None:
    data = delivery.payload.get("template_data") or {}
    limits = {"customer_name": 30, "workshop": 30, "customer_phone": 15, "workshop_address": 200}
    for key, limit in limits.items():
        if not data.get(key):
            return f"missing template parameter: {key}"
        if len(str(data[key])) > limit:
            return f"template parameter exceeds {limit} characters: {key}"
    if not data.get("workshop_time"):
        return "missing template parameter: workshop_time"
    if not isinstance(data.get("customer_qty"), int) or data["customer_qty"] < 1:
        return "invalid template parameter: customer_qty"
    return None


async def _send(delivery: ZbsDelivery) -> tuple[bool, bool, dict, str | None]:
    if not settings.ZBS_ENABLED:
        return False, False, {}, "ZBS is disabled"
    if not delivery.phone:
        return False, False, {}, "missing phone"
    template_id = delivery.template_id or settings.ZBS_REGISTRATION_TEMPLATE_ID
    if not settings.ZBS_ACCESS_TOKEN or not template_id:
        return False, False, {}, "missing ZBS access token or template id"
    payload_error = _payload_error(delivery)
    if payload_error:
        return False, False, {}, payload_error
    request = {
        "phone": zbs_phone(delivery.phone),
        "template_id": template_id,
        "template_data": delivery.payload.get("template_data") or {},
        "tracking_id": str(delivery.id),
    }
    async with httpx.AsyncClient(timeout=settings.ZBS_REQUEST_TIMEOUT_SECONDS) as client:
        response = await client.post(
            settings.ZBS_API_URL,
            headers={"access_token": settings.ZBS_ACCESS_TOKEN},
            json=request,
        )
    data = response.json() if response.content else {}
    error = data.get("error")
    if response.is_success and error in (None, 0):
        return True, False, data, None
    message = data.get("message") or f"HTTP {response.status_code}"
    return False, _retryable(response.status_code, error), data, message


async def process_once(db: AsyncSession) -> None:
    if not settings.ZBS_ENABLED:
        return
    now = datetime.now(timezone.utc)
    stale_before = now - timedelta(minutes=10)
    await db.execute(update(ZbsDelivery).where(
        ZbsDelivery.event_type == "registration_confirmation",
        ZbsDelivery.status == "sending",
        ZbsDelivery.sending_started_at < stale_before,
    ).values(status="pending", next_attempt_at=now, updated_at=now))
    await db.commit()
    delivery = await db.scalar(select(ZbsDelivery).where(
        ZbsDelivery.event_type == "registration_confirmation",
        ZbsDelivery.status.in_(["pending", "failed"]),
        ZbsDelivery.next_attempt_at <= now,
    ).order_by(ZbsDelivery.created_at).with_for_update(skip_locked=True).limit(1))
    if not delivery:
        return
    expires_at = _expiry(delivery)
    if expires_at and now > expires_at:
        delivery.status = "expired"
        delivery.last_error = "Quá thời hạn 7 ngày kể từ lúc đăng ký"
        delivery.updated_at = now
        await db.commit()
        return
    delivery.status = "sending"
    delivery.attempt_count += 1
    delivery.sending_started_at = now
    delivery.updated_at = now
    await db.commit()
    try:
        ok, retryable, response, error = await _send(delivery)
    except Exception as exc:
        ok, retryable, response, error = False, True, {}, str(exc)
    delivery.provider_response = response
    delivery.updated_at = datetime.now(timezone.utc)
    if ok:
        delivery.status = "sent"
        delivery.sent_time = datetime.now(timezone.utc)
        delivery.msg_id = ((response.get("data") or {}).get("msg_id") if isinstance(response, dict) else None)
        delivery.last_error = None
    else:
        delivery.status = "failed"
        delivery.last_error = error
        if retryable and delivery.attempt_count < 5:
            delivery.next_attempt_at = datetime.now(timezone.utc) + timedelta(seconds=min(3600, 2 ** min(delivery.attempt_count, 10)))
        else:
            delivery.next_attempt_at = datetime.now(timezone.utc) + timedelta(days=3650)
    await db.commit()


async def worker_loop(session_maker) -> None:
    while True:
        try:
            async with session_maker() as db:
                await process_once(db)
        except Exception:
            logger.exception("ZBS worker iteration failed")
        await asyncio.sleep(max(1, settings.ZBS_WORKER_INTERVAL_SECONDS))
