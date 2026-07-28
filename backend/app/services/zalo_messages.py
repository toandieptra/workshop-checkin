import asyncio
import ipaddress
import logging
import re
import socket
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from urllib.parse import urlparse
from urllib.parse import urljoin

import httpx
from fastapi import HTTPException, UploadFile
from sqlalchemy import exists, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from ..config import settings
from ..db import async_session_maker
from ..models import (
    Guest, GuestZaloMapping, Workshop, ZaloDelivery, ZaloDeliveryItem,
    ZaloQuotaReservation, ZaloQuotaUsage, ZaloTemplate,
)
from .zalo_agent import bridge_request

log = logging.getLogger("zalo_messages")
VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")
BLOCK_TYPES = {"text", "image", "image_album", "video"}
TEMPLATE_VARIABLES = {
    "guest": [
        "full_name", "phone", "email", "company", "role_title", "business_model",
        "guest_type", "party_size", "actual_party_size", "registration_status",
        "checkin_status",
    ],
    "workshop": ["workshop_name", "workshop_date", "workshop_time", "workshop_location", "workshop_branch"],
}
KNOWN_TEMPLATE_VARIABLES = set(TEMPLATE_VARIABLES["guest"] + TEMPLATE_VARIABLES["workshop"])
PLACEHOLDER_RE = re.compile(r"\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}")


def validate_public_media_url(value: str) -> str:
    if value.startswith("/uploads/"):
        return value
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("media URL phải dùng http(s)")
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(parsed.hostname, parsed.port or 443)}
    except socket.gaierror as exc:
        raise ValueError("Không phân giải được media URL") from exc
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_global:
            raise ValueError("media URL không được trỏ tới mạng nội bộ")
    return value


def validate_template_text(text: str) -> None:
    remaining = PLACEHOLDER_RE.sub("", text)
    if "{" in remaining or "}" in remaining:
        raise ValueError("placeholder phải có dạng {{identifier}}")
    for name in PLACEHOLDER_RE.findall(text):
        if name not in KNOWN_TEMPLATE_VARIABLES:
            raise ValueError(f"placeholder không được hỗ trợ: {name}")


def validate_blocks(blocks: list[dict]) -> list[dict]:
    if not blocks:
        raise ValueError("content_blocks cần ít nhất 1 block")
    normalized: list[dict] = []
    pending_images: list[dict] = []
    media_count = 0

    def flush_images() -> None:
        if pending_images:
            normalized.append({"type": "image_album", "images": list(pending_images)})
            pending_images.clear()

    for block in blocks:
        if not isinstance(block, dict) or block.get("type") not in BLOCK_TYPES:
            raise ValueError("block type phải là text, image hoặc video")
        kind = block["type"]
        value = dict(block)
        if kind == "text":
            flush_images()
            if not str(value.get("text") or "").strip():
                raise ValueError("text block cần text")
            if len(str(value["text"])) > 2000:
                raise ValueError("text block tối đa 2000 ký tự")
            validate_template_text(str(value["text"]))
            normalized.append(value)
        elif kind in {"image", "image_album"}:
            images = [value] if kind == "image" else value.get("images")
            if not isinstance(images, list) or not images:
                raise ValueError("image block cần url")
            for image in images:
                if not isinstance(image, dict) or not image.get("url"):
                    raise ValueError("mỗi ảnh cần url")
                validate_public_media_url(str(image["url"]))
                pending_images.append({key: image[key] for key in ("url", "id") if key in image})
                media_count += 1
        else:
            flush_images()
            if not value.get("url"):
                raise ValueError("video block cần url")
            if not value.get("thumbnail_url"):
                raise ValueError("video block cần thumbnail_url")
            validate_public_media_url(str(value["url"]))
            validate_public_media_url(str(value["thumbnail_url"]))
            if (str(value["url"]).startswith("/") or str(value["thumbnail_url"]).startswith("/")) and not settings.PUBLIC_BASE_URL:
                raise ValueError("Cần cấu hình PUBLIC_BASE_URL để gửi video đã upload")
            normalized.append(value)
            media_count += 1
    flush_images()
    if media_count > min(settings.ZALO_TEMPLATE_MAX_MEDIA_COUNT, settings.ZALO_TEMPLATE_MAX_IMAGE_COUNT):
        raise ValueError("tổng số media (ảnh và video) vượt giới hạn 10")
    return normalized


def template_variables(guest: Guest, workshop: Workshop | None) -> dict[str, str]:
    values = {name: "" for name in KNOWN_TEMPLATE_VARIABLES}
    for name in TEMPLATE_VARIABLES["guest"]:
        value = getattr(guest, name, None)
        values[name] = "" if value is None else str(value)
    if workshop:
        values.update({
            "workshop_name": workshop.name or "",
            "workshop_date": workshop.event_date.strftime("%d/%m/%Y") if workshop.event_date else "",
            "workshop_time": workshop.event_time.strftime("%H:%M") if workshop.event_time else "",
            "workshop_location": workshop.location or "",
            "workshop_branch": workshop.branch or "",
        })
    return values


def render_template_text(text: str, values: dict[str, str]) -> str:
    rendered = PLACEHOLDER_RE.sub(lambda match: values.get(match.group(1), ""), text)
    if len(rendered) > 2000:
        raise ValueError("text block tối đa 2000 ký tự sau khi render")
    return rendered


def render_block(block: dict, values: dict[str, str]) -> dict:
    rendered = dict(block)
    if rendered.get("type") == "text":
        rendered["text"] = render_template_text(str(rendered.get("text") or ""), values)
    return rendered


def calls_per_guest(blocks: list[dict]) -> int:
    return len(validate_blocks(blocks))


def local_upload_path(kind: str, filename: str) -> tuple[Path, str]:
    ext = Path(filename).suffix.lower() or ".bin"
    folder = Path(settings.UPLOAD_DIR) / "zalo" / kind
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{__import__('uuid').uuid4().hex}{ext}"
    return path, f"/uploads/zalo/{kind}/{path.name}"


async def save_media(file: UploadFile, kind: str) -> dict:
    mime = (file.content_type or "").lower()
    allowed = (mime.startswith("image/") if kind == "image" else mime.startswith("video/"))
    if not allowed:
        raise HTTPException(400, f"Định dạng {kind} không được hỗ trợ")
    data = await file.read()
    if not data or len(data) > settings.ZALO_MEDIA_MAX_FILE_BYTES:
        raise HTTPException(400, "File rỗng hoặc vượt dung lượng cho phép")
    path, url = local_upload_path(kind, file.filename or kind)
    path.write_bytes(data)
    return {"url": url, "file_name": file.filename, "mime_type": mime, "file_size": len(data)}


async def cache_remote_media(blocks: list[dict]) -> list[dict]:
    async def download(url: str, kind: str) -> str:
        if url.startswith("/uploads/"):
            return url
        current = validate_public_media_url(url)
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=False) as client:
            for _ in range(4):
                response = await client.get(current)
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise ValueError("Media redirect không hợp lệ")
                    current = validate_public_media_url(urljoin(current, location))
                    continue
                response.raise_for_status()
                mime = response.headers.get("content-type", "").split(";", 1)[0].lower()
                expected = "image/" if kind == "image" else "video/"
                if not mime.startswith(expected):
                    raise ValueError(f"URL không trả về {kind} hợp lệ")
                data = response.content
                if not data or len(data) > settings.ZALO_MEDIA_MAX_FILE_BYTES:
                    raise ValueError("Media URL rỗng hoặc vượt dung lượng cho phép")
                suffix = Path(urlparse(current).path).suffix or (".jpg" if kind == "image" else ".mp4")
                path, local_url = local_upload_path(kind, f"remote{suffix}")
                path.write_bytes(data)
                return local_url
        raise ValueError("Media URL redirect quá nhiều lần")

    cached: list[dict] = []
    for original in blocks:
        block = dict(original)
        if block.get("type") == "image":
            block["url"] = await download(str(block.get("url") or ""), "image")
        elif block.get("type") == "image_album":
            block["images"] = [
                {**image, "url": await download(str(image.get("url") or ""), "image")}
                for image in block.get("images") or []
            ]
        elif block.get("type") == "video":
            block["url"] = await download(str(block.get("url") or ""), "video")
            block["thumbnail_url"] = await download(str(block.get("thumbnail_url") or ""), "image")
        cached.append(block)
    return cached


async def resolve_recipient(db: AsyncSession, guest: Guest, *, refresh: bool = False) -> GuestZaloMapping | None:
    if not settings.ZALO_AGENT_ACCOUNT_OWNER_ID:
        raise ValueError("Chưa cấu hình account_owner_id")
    mapping = await db.get(GuestZaloMapping, guest.id)
    if mapping and mapping.account_owner_id == settings.ZALO_AGENT_ACCOUNT_OWNER_ID and not refresh:
        return mapping
    async with async_session_maker() as quota_db:
        try:
            await consume_quota(quota_db, "friend_lookup", 1)
            await quota_db.commit()
        except Exception:
            await quota_db.rollback()
            raise
    try:
        result = await bridge_request("POST", "/resolve-recipient", {
            "account_owner_id": settings.ZALO_AGENT_ACCOUNT_OWNER_ID,
            "guest_id": str(guest.id), "name": guest.full_name, "phone": guest.phone,
        })
    except HTTPException as exc:
        if exc.status_code == 404:
            return None
        raise
    recipient_id = str(result.get("thread_id") or result.get("recipient_id") or result.get("user_id") or result.get("id") or "").strip()
    if not recipient_id:
        return None
    if mapping is None:
        mapping = GuestZaloMapping(guest_id=guest.id, account_owner_id=settings.ZALO_AGENT_ACCOUNT_OWNER_ID, recipient_id=recipient_id)
        db.add(mapping)
    mapping.account_owner_id = settings.ZALO_AGENT_ACCOUNT_OWNER_ID
    mapping.recipient_id = recipient_id
    mapping.recipient_name = result.get("recipient_name") or result.get("name")
    mapping.resolution = result
    mapping.resolved_at = mapping.refreshed_at = datetime.now(timezone.utc)
    await db.flush()
    return mapping


async def resolve_recipients(db: AsyncSession, guests: list[Guest], *, refresh: bool = False) -> dict:
    if not settings.ZALO_AGENT_ACCOUNT_OWNER_ID:
        raise ValueError("Chưa cấu hình account_owner_id")
    pending = []
    resolved = {}
    for guest in guests:
        mapping = await db.get(GuestZaloMapping, guest.id)
        if mapping and mapping.account_owner_id == settings.ZALO_AGENT_ACCOUNT_OWNER_ID and not refresh:
            resolved[guest.id] = mapping
        else:
            pending.append(guest)

    if not pending:
        return resolved

    async with async_session_maker() as quota_db:
        try:
            await consume_quota(quota_db, "friend_lookup", len(pending))
            await quota_db.commit()
        except Exception:
            await quota_db.rollback()
            raise

    result = await bridge_request("POST", "/resolve-recipients", {
        "account_owner_id": settings.ZALO_AGENT_ACCOUNT_OWNER_ID,
        "recipients": [
            {"guest_id": str(guest.id), "name": guest.full_name, "phone": guest.phone}
            for guest in pending
        ],
    })
    items = {item.get("guest_id"): item for item in result.get("recipients", [])}
    for guest in pending:
        item = items.get(str(guest.id), {})
        recipient_id = str(item.get("thread_id") or item.get("recipient_id") or item.get("user_id") or item.get("id") or "").strip()
        if not recipient_id:
            continue
        mapping = await db.get(GuestZaloMapping, guest.id)
        if mapping is None:
            mapping = GuestZaloMapping(
                guest_id=guest.id,
                account_owner_id=settings.ZALO_AGENT_ACCOUNT_OWNER_ID,
                recipient_id=recipient_id,
            )
            db.add(mapping)
        mapping.account_owner_id = settings.ZALO_AGENT_ACCOUNT_OWNER_ID
        mapping.recipient_id = recipient_id
        mapping.recipient_name = item.get("recipient_name") or item.get("name")
        mapping.resolution = item
        mapping.resolved_at = mapping.refreshed_at = datetime.now(timezone.utc)
        await db.flush()
        resolved[guest.id] = mapping
    return resolved


async def selected_guests(db: AsyncSession, guest_ids: list, workshop_id=None) -> list[Guest]:
    stmt = select(Guest).where(Guest.deleted_at.is_(None))
    if guest_ids:
        stmt = stmt.where(Guest.id.in_(guest_ids))
    elif workshop_id:
        stmt = stmt.where(Guest.workshop_id == workshop_id)
    else:
        return []
    return list((await db.execute(stmt.order_by(Guest.full_name))).scalars().all())


def quota_limit(capability: str) -> int:
    if capability == "friend_lookup":
        return settings.ZALO_FRIEND_LOOKUP_DAILY_QUOTA
    if capability == "message":
        return settings.ZALO_MESSAGES_DAILY_QUOTA
    raise ValueError("capability quota không hợp lệ")


async def quota_usage(db: AsyncSession, capability: str, *, now: datetime | None = None, lock: bool = False) -> ZaloQuotaUsage:
    owner_id = settings.ZALO_AGENT_ACCOUNT_OWNER_ID
    if not owner_id:
        raise ValueError("Chưa cấu hình account_owner_id")
    now = now or datetime.now(timezone.utc)
    day = now.astimezone(VN_TZ).date()
    limit = quota_limit(capability)
    await db.execute(text("""
        INSERT INTO zalo_quota_usage (account_owner_id, capability, usage_date, daily_limit)
        VALUES (:owner_id, :capability, :day, :limit)
        ON CONFLICT (account_owner_id, capability, usage_date)
        DO UPDATE SET daily_limit = EXCLUDED.daily_limit
    """), {"owner_id": owner_id, "capability": capability, "day": day, "limit": limit})
    stmt = select(ZaloQuotaUsage).where(
        ZaloQuotaUsage.account_owner_id == owner_id,
        ZaloQuotaUsage.capability == capability,
        ZaloQuotaUsage.usage_date == day,
    )
    if lock:
        stmt = stmt.with_for_update()
    usage = await db.scalar(stmt)
    if not usage:
        raise RuntimeError("Không tạo được quota usage")
    return usage


async def consume_quota(db: AsyncSession, capability: str, amount: int) -> None:
    usage = await quota_usage(db, capability, lock=True)
    if amount < 1 or usage.used_count + usage.reserved_count + amount > usage.daily_limit:
        raise ValueError(f"Đã vượt quota {capability} trong ngày")
    usage.used_count += amount
    usage.updated_at = datetime.now(timezone.utc)


async def reserve_quota(db: AsyncSession, amount: int, delivery_id, *, capability: str = "message", now: datetime | None = None) -> ZaloQuotaReservation:
    if amount < 1:
        raise ValueError("quota reservation phải lớn hơn 0")
    now = now or datetime.now(timezone.utc)
    usage = await quota_usage(db, capability, now=now, lock=True)
    day = usage.usage_date
    # Active deliveries own their reservation until every item reaches a terminal
    # state. A wall-clock TTL must not release quota while the worker can still send.
    if not usage or usage.used_count + usage.reserved_count + amount > usage.daily_limit:
        raise ValueError("Đã vượt quota gửi Zalo trong ngày")
    usage.reserved_count += amount
    usage.updated_at = now
    reservation = ZaloQuotaReservation(
        account_owner_id=usage.account_owner_id, capability=capability,
        usage_date=day, delivery_id=delivery_id, amount=amount,
        expires_at=now + timedelta(seconds=settings.ZALO_MESSAGES_RESERVATION_TTL_SECONDS),
    )
    db.add(reservation)
    await db.flush()
    return reservation


async def settle_quota(db: AsyncSession, delivery_id, *, consumed: int = 0, released: int = 0) -> None:
    reservation = await db.scalar(select(ZaloQuotaReservation).where(
        ZaloQuotaReservation.delivery_id == delivery_id,
    ).with_for_update())
    if not reservation:
        return
    unsettled = reservation.amount - reservation.consumed_count - reservation.released_count
    consumed = min(max(0, consumed), unsettled)
    released = min(max(0, released), unsettled - consumed)
    if not consumed and not released:
        return
    usage = await db.scalar(select(ZaloQuotaUsage).where(
        ZaloQuotaUsage.account_owner_id == reservation.account_owner_id,
        ZaloQuotaUsage.capability == reservation.capability,
        ZaloQuotaUsage.usage_date == reservation.usage_date,
    ).with_for_update())
    if not usage:
        raise RuntimeError("Không tìm thấy quota usage của reservation")
    usage.reserved_count -= consumed + released
    usage.used_count += consumed
    reservation.consumed_count += consumed
    reservation.released_count += released
    if reservation.consumed_count + reservation.released_count == reservation.amount:
        reservation.status = "completed" if reservation.consumed_count else "released"
    usage.updated_at = reservation.updated_at = datetime.now(timezone.utc)


async def reopen_quota(db: AsyncSession, delivery_id, amount: int = 1) -> None:
    reservation = await db.scalar(select(ZaloQuotaReservation).where(
        ZaloQuotaReservation.delivery_id == delivery_id,
    ).with_for_update())
    if not reservation or reservation.released_count < amount:
        raise ValueError("Không còn quota reservation để retry")
    usage = await db.scalar(select(ZaloQuotaUsage).where(
        ZaloQuotaUsage.account_owner_id == reservation.account_owner_id,
        ZaloQuotaUsage.capability == reservation.capability,
        ZaloQuotaUsage.usage_date == reservation.usage_date,
    ).with_for_update())
    if not usage or usage.used_count + usage.reserved_count + amount > usage.daily_limit:
        raise ValueError("Đã vượt quota gửi Zalo trong ngày")
    reservation.released_count -= amount
    reservation.status = "active"
    usage.reserved_count += amount
    usage.updated_at = reservation.updated_at = datetime.now(timezone.utc)


async def ensure_current_day_reservation(db: AsyncSession, delivery_id) -> None:
    reservation = await db.scalar(select(ZaloQuotaReservation).where(
        ZaloQuotaReservation.delivery_id == delivery_id,
    ).with_for_update())
    if not reservation:
        raise RuntimeError("Không tìm thấy quota reservation")
    now = datetime.now(timezone.utc)
    current_day = now.astimezone(VN_TZ).date()
    if reservation.usage_date == current_day:
        return
    remainder = reservation.amount - reservation.consumed_count - reservation.released_count
    old_usage = await db.scalar(select(ZaloQuotaUsage).where(
        ZaloQuotaUsage.account_owner_id == reservation.account_owner_id,
        ZaloQuotaUsage.capability == reservation.capability,
        ZaloQuotaUsage.usage_date == reservation.usage_date,
    ).with_for_update())
    new_usage = await quota_usage(db, reservation.capability, now=now, lock=True)
    if new_usage.used_count + new_usage.reserved_count + remainder > new_usage.daily_limit:
        raise ValueError("Không đủ quota gửi Zalo của ngày hiện tại")
    if old_usage:
        old_usage.reserved_count = max(0, old_usage.reserved_count - remainder)
    new_usage.reserved_count += remainder
    reservation.usage_date = current_day
    reservation.updated_at = now


async def create_delivery(db: AsyncSession, template: ZaloTemplate, guests: list[Guest], created_by=None, batch_id=None, refresh=False, idempotency_key=None) -> ZaloDelivery:
    if not settings.ZALO_MESSAGES_ENABLED:
        raise ValueError("Zalo messages đang bị tắt")
    blocks = validate_blocks(template.content_blocks)
    delivery = ZaloDelivery(batch_id=batch_id, template_id=template.id, template_name=template.name,
                             content_blocks=blocks, recipient_count=len(guests), created_by=created_by,
                             idempotency_key=str(idempotency_key))
    db.add(delivery)
    await db.flush()
    resolved: list[tuple[Guest, GuestZaloMapping]] = []
    workshops: dict = {}
    for guest in guests:
        mapping = await resolve_recipient(db, guest, refresh=refresh)
        if mapping:
            resolved.append((guest, mapping))
            if guest.workshop_id not in workshops:
                workshops[guest.workshop_id] = await db.get(Workshop, guest.workshop_id)
    if not resolved:
        raise ValueError("Không resolve được recipient Zalo nào")
    delivery.recipient_count = len(resolved)
    required = len(blocks) * len(resolved)
    await reserve_quota(db, required, delivery.id)
    for guest, mapping in resolved:
        for position, block in enumerate(blocks):
            db.add(ZaloDeliveryItem(
                delivery_id=delivery.id, guest_id=guest.id,
                recipient_id=mapping.recipient_id, recipient_name=mapping.recipient_name,
                phone=guest.phone, block_position=position,
                block_payload=render_block(block, template_variables(guest, workshops.get(guest.workshop_id))),
                quota_cost=1,
            ))
    await db.flush()
    return delivery


AUTO_SEND_NEW_GUEST = "auto_send_new_guest"
AUTO_SEND_CHECKIN = "auto_send_checkin"


async def _already_auto_sent(db: AsyncSession, template_id, guest_id, event_type: str) -> bool:
    return await db.scalar(select(ZaloDelivery.id).where(
        ZaloDelivery.template_id == template_id,
        ZaloDelivery.idempotency_key == f"{event_type}:{template_id}:{guest_id}",
    ).limit(1)) is not None


async def enqueue_auto_send(db: AsyncSession, guest: Guest, event_type: str) -> list[ZaloDelivery]:
    if not settings.ZALO_MESSAGES_ENABLED:
        return []
    if event_type not in {AUTO_SEND_NEW_GUEST, AUTO_SEND_CHECKIN}:
        raise ValueError("event_type auto-send không hợp lệ")
    flag = event_type
    templates = list((await db.execute(select(ZaloTemplate).where(
        ZaloTemplate.status == "active",
        getattr(ZaloTemplate, flag).is_(True),
    ).order_by(ZaloTemplate.updated_at.desc()))).scalars())
    deliveries: list[ZaloDelivery] = []
    for template in templates:
        key = f"{event_type}:{template.id}:{guest.id}"
        if await _already_auto_sent(db, template.id, guest.id, event_type):
            continue
        try:
            delivery = await create_delivery(
                db, template, [guest], created_by=None, idempotency_key=key,
            )
            deliveries.append(delivery)
        except ValueError as exc:
            log.warning("auto-send %s skipped for template=%s guest=%s: %s", event_type, template.id, guest.id, exc)
    return deliveries


async def enqueue_auto_send_new_guest(db: AsyncSession, guest: Guest) -> list[ZaloDelivery]:
    return await enqueue_auto_send(db, guest, AUTO_SEND_NEW_GUEST)


async def enqueue_auto_send_checkin(db: AsyncSession, guest: Guest) -> list[ZaloDelivery]:
    return await enqueue_auto_send(db, guest, AUTO_SEND_CHECKIN)


async def process_once(db: AsyncSession) -> None:
    now = datetime.now(timezone.utc)
    await db.execute(update(ZaloDeliveryItem).where(
        ZaloDeliveryItem.status == "sending",
        ZaloDeliveryItem.sending_started_at < now - timedelta(minutes=10),
    ).values(status="pending", next_attempt_at=now, updated_at=now))
    earlier = aliased(ZaloDeliveryItem)
    item = await db.scalar(select(ZaloDeliveryItem).where(
        ZaloDeliveryItem.status == "pending", ZaloDeliveryItem.next_attempt_at <= now,
        ZaloDeliveryItem.recipient_id.is_not(None),
        ~exists().where(
            earlier.delivery_id == ZaloDeliveryItem.delivery_id,
            earlier.guest_id == ZaloDeliveryItem.guest_id,
            earlier.block_position < ZaloDeliveryItem.block_position,
            earlier.status != "sent",
        ),
    ).order_by(ZaloDeliveryItem.created_at, ZaloDeliveryItem.guest_id,
               ZaloDeliveryItem.block_position).with_for_update(skip_locked=True).limit(1))
    if not item:
        await db.commit()
        return
    delivery = await db.get(ZaloDelivery, item.delivery_id)
    try:
        await ensure_current_day_reservation(db, delivery.id)
    except ValueError as exc:
        item.next_attempt_at = now + timedelta(minutes=5)
        item.last_error = str(exc)
        await db.commit()
        return
    item.status, item.attempt_count, item.sending_started_at = "sending", item.attempt_count + 1, now
    await db.commit()
    try:
        message_ids = list(item.message_ids or [])
        block = item.block_payload
        payload = {
            "account_owner_id": settings.ZALO_AGENT_ACCOUNT_OWNER_ID,
            "thread_id": item.recipient_id, "thread_type": 0,
            "delivery_id": str(delivery.id), "item_id": str(item.id),
        }
        if block["type"] == "text":
            payload.update({"type": "text", "text": block["text"]})
        elif block["type"] == "image_album":
            # The bridge runs in a separate container and sees uploads at
            # /uploads, while local development may use a host upload path.
            paths = [f"/uploads/{str(image['url']).removeprefix('/uploads/')}" for image in block["images"]]
            payload.update({"type": "image_album", "paths": paths})
            if block.get("caption") is not None:
                payload["caption"] = block["caption"]
        else:
            url = str(block["url"])
            thumb = str(block["thumbnail_url"])
            if url.startswith("/"):
                url = f"{(settings.PUBLIC_BASE_URL or '').rstrip('/')}{url}"
            if thumb.startswith("/"):
                thumb = f"{(settings.PUBLIC_BASE_URL or '').rstrip('/')}{thumb}"
            payload.update({"type": "video", "url": url, "thumbnail_url": thumb,
                            "metadata": block.get("metadata") or {}})
            if block.get("caption") is not None:
                payload["caption"] = block["caption"]
        result = await bridge_request("POST", "/messages", payload)
        result_data = result.get("result") if isinstance(result, dict) else {}
        message_id = (result_data or {}).get("message_id") or (result_data or {}).get("msg_id") or result.get("message_id")
        if message_id:
            message_ids.append(str(message_id))
        item.status, item.message_ids, item.sent_at = "sent", message_ids, datetime.now(timezone.utc)
        item.provider_response = result
        await settle_quota(db, delivery.id, consumed=item.quota_cost)
    except Exception as exc:
        item.last_error = str(exc)
        item.provider_response = item.provider_response or {}
        if isinstance(exc, HTTPException) and exc.status_code == 503:
            item.status = "unknown"
            await settle_quota(db, delivery.id, consumed=item.quota_cost)
            item.updated_at = datetime.now(timezone.utc)
            await db.commit()
            return
        if item.attempt_count < settings.ZALO_MESSAGES_MAX_ATTEMPTS:
            item.status, item.next_attempt_at = "pending", now + timedelta(seconds=2 ** item.attempt_count)
        else:
            item.status = "failed"
            await settle_quota(db, delivery.id, released=item.quota_cost)
            blocked = await db.scalars(select(ZaloDeliveryItem).where(
                ZaloDeliveryItem.delivery_id == item.delivery_id,
                ZaloDeliveryItem.guest_id == item.guest_id,
                ZaloDeliveryItem.block_position > item.block_position,
                ZaloDeliveryItem.status == "pending",
            ))
            blocked_items = list(blocked)
            for blocked_item in blocked_items:
                blocked_item.status = "failed"
                blocked_item.last_error = "Bị chặn bởi provider call trước đó"
                blocked_item.updated_at = datetime.now(timezone.utc)
            if blocked_items:
                await settle_quota(db, delivery.id, released=sum(x.quota_cost for x in blocked_items))
    item.updated_at = datetime.now(timezone.utc)
    remaining = await db.scalar(select(ZaloDeliveryItem.id).where(
        ZaloDeliveryItem.delivery_id == delivery.id, ZaloDeliveryItem.status.in_(["pending", "sending"])
    ).limit(1))
    if not remaining:
        guest_states = (await db.execute(select(
            ZaloDeliveryItem.guest_id, ZaloDeliveryItem.status
        ).where(ZaloDeliveryItem.delivery_id == delivery.id))).all()
        statuses: dict = {}
        for guest_id, status in guest_states:
            statuses.setdefault(guest_id, []).append(status)
        delivery.sent_count = sum(all(status == "sent" for status in values) for values in statuses.values())
        delivery.failed_count = sum(any(status == "failed" for status in values) for values in statuses.values())
        has_pending = any(status in {"pending", "sending"} for values in statuses.values() for status in values)
        has_success = any(status == "sent" for values in statuses.values() for status in values)
        has_failed = any(status == "failed" for values in statuses.values() for status in values)
        if has_pending:
            delivery.status = "queued"
        elif has_failed and has_success:
            delivery.status = "partial_success"
        elif has_failed:
            delivery.status = "failed"
        else:
            delivery.status = "success"
        delivery.completed_at = datetime.now(timezone.utc)
        if delivery.batch_id:
            from ..models import ZaloDeliveryBatch
            batch = await db.get(ZaloDeliveryBatch, delivery.batch_id)
            if batch:
                batch.status = delivery.status
                batch.updated_at = delivery.completed_at
    delivery.updated_at = datetime.now(timezone.utc)
    await db.commit()


async def worker_loop(session_maker) -> None:
    while True:
        try:
            async with session_maker() as db:
                await process_once(db)
        except Exception:
            log.exception("Zalo message worker iteration failed")
        await asyncio.sleep(max(1, settings.ZALO_MESSAGES_WORKER_INTERVAL_SECONDS))
