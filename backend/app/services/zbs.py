import logging
import asyncio
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import Guest, Workshop, ZbsDelivery, ZbsTaskConfig, ZbsTemplate

logger = logging.getLogger("zbs")
REGISTRATION_TASK_KEY = "registration_confirmation"
REGISTRATION_TASK_LABEL = "Xác nhận đăng ký Workshop"
CHECKIN_TASK_KEY = "checkin_confirmation"
CHECKIN_TASK_LABEL = "Xác nhận Check-in Workshop"
CHECKIN_TEMPLATE_ID = "610839"
TASK_DEFINITIONS = (
    (REGISTRATION_TASK_KEY, REGISTRATION_TASK_LABEL),
    (CHECKIN_TASK_KEY, CHECKIN_TASK_LABEL),
)
TEMPLATE_LIST_URL = "https://business.openapi.zalo.me/template/all"
TEMPLATE_DETAIL_URL = "https://business.openapi.zalo.me/template/info/v2"
VIETNAM_TIMEZONE = ZoneInfo("Asia/Ho_Chi_Minh")


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


def _checkin_time(value: datetime | None) -> str:
    if value is None:
        return ""
    value = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return value.astimezone(VIETNAM_TIMEZONE).strftime("%H:%M %d/%m/%Y")


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


async def enqueue_registration(db: AsyncSession, guest: Guest) -> None:
    await _enqueue_task(db, guest, REGISTRATION_TASK_KEY)


async def enqueue_checkin(db: AsyncSession, guest: Guest) -> None:
    await _enqueue_task(db, guest, CHECKIN_TASK_KEY)


async def refresh_registration_recipient(db: AsyncSession, guest: Guest) -> None:
    delivery = (await db.execute(select(ZbsDelivery).where(
        ZbsDelivery.guest_id == guest.id,
        ZbsDelivery.event_type == REGISTRATION_TASK_KEY,
        ZbsDelivery.status.in_(["pending", "failed"]),
    ).order_by(ZbsDelivery.created_at.desc()))).scalars().first()
    if not delivery:
        return
    phone = normalize_phone(guest.phone)
    template_data = dict(delivery.payload.get("template_data") or {})
    template_data["customer_phone"] = zbs_phone(phone)
    delivery.phone = phone or None
    delivery.payload = {**delivery.payload, "template_data": template_data}
    delivery.updated_at = datetime.now(timezone.utc)


async def enqueue_manual(db: AsyncSession, guest: Guest, task_key: str) -> ZbsDelivery:
    if task_key not in {REGISTRATION_TASK_KEY, CHECKIN_TASK_KEY}:
        raise ValueError("Tác vụ ZBS không tồn tại")
    config = await db.get(ZbsTaskConfig, task_key)
    if not config or not config.template_id:
        raise ValueError("Tác vụ chưa được gắn mẫu tin ZBS")
    template = await db.get(ZbsTemplate, config.template_id)
    if not template or template.status != "ENABLE":
        raise ValueError("Mẫu tin ZBS chưa được kích hoạt")
    if task_key == CHECKIN_TASK_KEY and guest.checkin_status != "checked_in":
        raise ValueError("Khách chưa Check-in")
    if task_key == REGISTRATION_TASK_KEY and guest.registration_status != "confirmed":
        raise ValueError("Khách chưa được xác nhận đăng ký")

    existing = (await db.execute(select(ZbsDelivery).where(
        ZbsDelivery.guest_id == guest.id,
        ZbsDelivery.event_type == task_key,
    ).order_by(ZbsDelivery.created_at.desc()))).scalars().first()
    if existing:
        if existing.status != "failed":
            raise ValueError("Tin ZBS đã được xếp hàng hoặc đã gửi")
        workshop = await db.get(Workshop, guest.workshop_id)
        if not workshop:
            raise ValueError("Không tìm thấy Workshop")
        phone = normalize_phone(guest.phone)
        template_data = _template_data(guest, workshop, phone)
        if task_key == CHECKIN_TASK_KEY:
            template_data = {
                "customer_name": template_data["customer_name"],
                "workshop": template_data["workshop"],
                "customer_checkin_time": _checkin_time(guest.checked_in_at),
            }
        now = datetime.now(timezone.utc)
        existing.status = "pending"
        existing.phone = phone or None
        existing.next_attempt_at = now
        existing.last_error = None
        existing.payload = {
            **existing.payload,
            "template_data": template_data,
            "event_at": now.isoformat(),
            "manual": True,
        }
        existing.template_id = config.template_id
        existing.updated_at = now
        return existing

    delivery = await _enqueue_task(db, guest, task_key, force=True, manual=True)
    if delivery is None:
        raise ValueError("Không thể tạo tin ZBS thủ công")
    return delivery


async def _enqueue_task(
    db: AsyncSession,
    guest: Guest,
    task_key: str,
    old_phone: str | None = None,
    force: bool = False,
    manual: bool = False,
) -> ZbsDelivery | None:
    if task_key == REGISTRATION_TASK_KEY and guest.registration_status != "confirmed":
        return
    task_config = await db.get(ZbsTaskConfig, task_key)
    if not force and task_key == CHECKIN_TASK_KEY and task_config is None:
        return
    if not force and task_config and not task_config.enabled:
        return
    default_template_id = CHECKIN_TEMPLATE_ID if task_key == CHECKIN_TASK_KEY else settings.ZBS_REGISTRATION_TEMPLATE_ID
    template_id = task_config.template_id if task_config else default_template_id
    if not template_id:
        return
    phone = normalize_phone(guest.phone)
    if old_phone is not None and normalize_phone(old_phone) == phone:
        return
    previous = (await db.execute(select(ZbsDelivery).where(
        ZbsDelivery.guest_id == guest.id,
        ZbsDelivery.event_type == task_key,
    ).order_by(ZbsDelivery.created_at.desc()))).scalars().all()
    if task_key == REGISTRATION_TASK_KEY and old_phone is not None and any(item.status in ("sent", "delivered", "sending") for item in previous):
        return
    event_key = f"{task_key}:{guest.id}"
    if any(item.event_key == event_key for item in previous):
        return
    if task_key == REGISTRATION_TASK_KEY and old_phone is not None:
        await db.execute(update(ZbsDelivery).where(
            ZbsDelivery.guest_id == guest.id,
            ZbsDelivery.event_type == task_key,
            ZbsDelivery.phone == normalize_phone(old_phone),
            ZbsDelivery.status.in_(["pending", "failed"]),
        ).values(status="cancelled", updated_at=datetime.now(timezone.utc)))
    workshop = await db.get(Workshop, guest.workshop_id)
    if not workshop:
        return
    registered_at = _registered_at(guest)
    event_at = datetime.now(timezone.utc) if manual else guest.checked_in_at if task_key == CHECKIN_TASK_KEY else registered_at
    event_at = event_at or datetime.now(timezone.utc)
    event_at = event_at if event_at.tzinfo else event_at.replace(tzinfo=timezone.utc)
    template_data = _template_data(guest, workshop, phone)
    if task_key == CHECKIN_TASK_KEY:
        template_data = {
            "customer_name": template_data["customer_name"],
            "workshop": template_data["workshop"],
            "customer_checkin_time": _checkin_time(guest.checked_in_at),
        }
    delivery = ZbsDelivery(
        guest_id=guest.id, workshop_id=guest.workshop_id,
        event_type=task_key, event_key=event_key,
        phone=phone or None, template_id=template_id,
        payload={
            "template_data": template_data,
            "registered_at": registered_at.isoformat(),
            "event_at": event_at.isoformat(),
            "manual": manual,
        },
        status="expired" if datetime.now(timezone.utc) > event_at + timedelta(days=7) else "pending",
    )
    db.add(delivery)
    return delivery


def _retryable(status: int, error: int | None) -> bool:
    return status >= 500 or status in (408, 429) or error in (1001, 1002, 1003)


def _expiry(delivery: ZbsDelivery) -> datetime | None:
    try:
        value = datetime.fromisoformat(delivery.payload.get("event_at") or delivery.payload.get("registered_at", ""))
        value = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return value + timedelta(days=7)
    except (TypeError, ValueError):
        return None


def _payload_error(delivery: ZbsDelivery) -> str | None:
    data = delivery.payload.get("template_data") or {}
    if delivery.event_type == CHECKIN_TASK_KEY:
        for key in ("customer_name", "workshop", "customer_checkin_time"):
            if not data.get(key):
                return f"missing template parameter: {key}"
        return None
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
    enabled_tasks = (await db.execute(
        select(ZbsTaskConfig.task_key).where(ZbsTaskConfig.enabled.is_(True))
    )).scalars().all()
    task_keys = list(enabled_tasks)
    now = datetime.now(timezone.utc)
    stale_before = now - timedelta(minutes=10)
    await db.execute(update(ZbsDelivery).where(
        or_(
            ZbsDelivery.event_type.in_(task_keys),
            ZbsDelivery.payload.contains({"manual": True}),
        ),
        ZbsDelivery.status == "sending",
        ZbsDelivery.sending_started_at < stale_before,
    ).values(status="pending", next_attempt_at=now, updated_at=now))
    await db.commit()
    delivery = await db.scalar(select(ZbsDelivery).where(
        or_(
            ZbsDelivery.event_type.in_(task_keys),
            ZbsDelivery.payload.contains({"manual": True}),
        ),
        ZbsDelivery.status.in_(["pending", "failed"]),
        ZbsDelivery.next_attempt_at <= now,
    ).order_by(ZbsDelivery.created_at).with_for_update(skip_locked=True).limit(1))
    if not delivery:
        return
    expires_at = _expiry(delivery)
    if expires_at and now > expires_at:
        delivery.status = "expired"
        delivery.last_error = "Quá thời hạn 7 ngày kể từ lúc phát sinh tác vụ"
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


def _zalo_created_at(value: object) -> datetime | None:
    try:
        timestamp = float(value)
    except (TypeError, ValueError):
        return None
    if timestamp > 10_000_000_000:
        timestamp /= 1000
    try:
        return datetime.fromtimestamp(timestamp, timezone.utc)
    except (OSError, OverflowError, ValueError):
        return None


def _zalo_data(response: httpx.Response) -> object:
    try:
        payload = response.json()
    except ValueError as exc:
        raise RuntimeError("Zalo trả về dữ liệu không hợp lệ") from exc
    if not response.is_success or payload.get("error") not in (None, 0):
        message = payload.get("message") or f"HTTP {response.status_code}"
        raise RuntimeError(str(message))
    return payload.get("data")


async def sync_templates(db: AsyncSession) -> dict[str, int]:
    if not settings.ZBS_ACCESS_TOKEN:
        raise RuntimeError("Chưa cấu hình ZBS_ACCESS_TOKEN")
    headers = {"access_token": settings.ZBS_ACCESS_TOKEN}
    remote_items: list[dict] = []
    offset = 0
    total = 1
    async with httpx.AsyncClient(timeout=settings.ZBS_REQUEST_TIMEOUT_SECONDS) as client:
        while offset < total:
            response = await client.get(
                TEMPLATE_LIST_URL,
                headers=headers,
                params={"offset": offset, "limit": 100, "filterPreset": 0},
            )
            data = _zalo_data(response)
            if not isinstance(data, list):
                raise RuntimeError("Danh sách template từ Zalo không hợp lệ")
            remote_items.extend(item for item in data if isinstance(item, dict))
            payload = response.json()
            total = int((payload.get("metadata") or {}).get("total") or len(remote_items))
            if not data:
                break
            offset += len(data)

        created = 0
        updated = 0
        now = datetime.now(timezone.utc)
        for item in remote_items:
            template_id = str(item.get("templateId") or "").strip()
            if not template_id:
                continue
            detail_response = await client.get(
                TEMPLATE_DETAIL_URL,
                headers=headers,
                params={"template_id": template_id},
            )
            detail_value = _zalo_data(detail_response)
            detail = detail_value if isinstance(detail_value, dict) else {}
            template = await db.get(ZbsTemplate, template_id)
            if template is None:
                template = ZbsTemplate(
                    template_id=template_id,
                    template_name=str(item.get("templateName") or detail.get("templateName") or template_id),
                    status=str(item.get("status") or detail.get("status") or "PENDING_REVIEW"),
                )
                db.add(template)
                created += 1
            else:
                updated += 1
            template.template_name = str(item.get("templateName") or detail.get("templateName") or template_id)
            template.status = str(item.get("status") or detail.get("status") or template.status)
            template.quality = item.get("templateQuality") or detail.get("templateQuality")
            template.tag = detail.get("templateTag")
            raw_type = detail.get("templateType") or detail.get("template_type")
            try:
                template.template_type = int(raw_type) if raw_type is not None else None
            except (TypeError, ValueError):
                template.template_type = None
            template.detail = detail
            template.preview_url = detail.get("previewUrl") or detail.get("preview_url")
            template.price_sdt = detail.get("price_sdt")
            template.price_uid = detail.get("price_uid")
            template.zalo_created_at = _zalo_created_at(item.get("createdTime"))
            template.updated_at = now
            template.synced_at = now

    await db.commit()
    return {"synced": created + updated, "created": created, "updated": updated}


async def worker_loop(session_maker) -> None:
    while True:
        try:
            async with session_maker() as db:
                await process_once(db)
        except Exception:
            logger.exception("ZBS worker iteration failed")
        await asyncio.sleep(max(1, settings.ZBS_WORKER_INTERVAL_SECONDS))
