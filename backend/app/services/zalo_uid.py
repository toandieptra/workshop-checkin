"""UID Zalo của khách, nhận qua webhook ZNS.

Khi gửi ZNS, Zalo chỉ trả msg_id. Sau khi khách nhận tin, Zalo bắn webhook
`user_received_message` có `recipient.id` = UID người dùng (dùng được để gửi ZNS qua UID,
tin OA, remarketing). Ta lưu UID theo SĐT đã chuẩn hoá để mọi đăng ký cùng SĐT dùng chung.

Định dạng Zalo (lồng nhau):
    {"app_id": "...", "event_name": "user_received_message", "timestamp": "1700000000000",
     "sender": {"id": "<oa_id>"}, "recipient": {"id": "<uid>"},
     "message": {"msg_id": "...", "tracking_id": "...", "delivery_time": "1700000000000"}}
Vẫn nhận định dạng phẳng cũ {"msg_id", "tracking_id", "delivery_time"} để không phá tích hợp hiện có.
"""
from __future__ import annotations

import hashlib
import hmac
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Guest, ZaloContactUid
from .zbs import normalize_phone

DELIVERY_EVENTS = {None, "", "user_received_message"}


@dataclass
class WebhookEvent:
    event_name: str | None
    msg_id: str | None
    tracking_id: str | None
    delivered_at: datetime | None
    uid: str | None

    @property
    def is_delivery(self) -> bool:
        return self.event_name in DELIVERY_EVENTS


def _ts(value) -> datetime | None:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if v > 10_000_000_000:  # mili giây
        v /= 1000
    try:
        return datetime.fromtimestamp(v, timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def _str(value) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def parse_webhook(body: dict) -> WebhookEvent:
    msg = body.get("message") if isinstance(body.get("message"), dict) else {}
    recipient = body.get("recipient") if isinstance(body.get("recipient"), dict) else {}
    event_name = _str(body.get("event_name"))
    return WebhookEvent(
        event_name=event_name,
        msg_id=_str(msg.get("msg_id") or body.get("msg_id")),
        tracking_id=_str(msg.get("tracking_id") or body.get("tracking_id")),
        delivered_at=_ts(msg.get("delivery_time") or body.get("delivery_time") or body.get("timestamp")),
        # UID chỉ lấy từ sự kiện nhận tin; recipient.id ở sự kiện khác có thể là đối tượng khác.
        uid=_str(recipient.get("id") or body.get("user_id")) if event_name == "user_received_message" or not event_name else None,
    )


def signature_variant(raw: bytes, body: dict, header: str | None, app_id: str | None, oa_secret: str | None,
                      header_ts: str | None = None) -> str | None:
    """Trả tên biến thể chữ ký khớp (mọi biến thể đều cần OA secret), None nếu không khớp."""
    if not oa_secret or not header:
        return None
    given = (header.split("=", 1)[1] if header.lower().startswith("mac=") else header).strip().lower()
    data = raw.decode("utf-8")
    apps = [a for a in {_str(body.get("app_id")), app_id} if a]
    stamps = [t for t in {str(body.get("timestamp", "")), header_ts or ""}]
    cands: list[tuple[str, str]] = []
    for app in apps:
        for ts in stamps:
            cands.append((f"sha256(app+data+ts+secret)[ts={'hdr' if ts == header_ts and ts else 'body'}]",
                          hashlib.sha256(f"{app}{data}{ts}{oa_secret}".encode()).hexdigest()))
            cands.append(("hmac(secret, app+data+ts)", hmac.new(oa_secret.encode(), f"{app}{data}{ts}".encode(), hashlib.sha256).hexdigest()))
    cands.append(("hmac(secret, data)", hmac.new(oa_secret.encode(), raw, hashlib.sha256).hexdigest()))
    cands.append(("sha256(data+secret)", hashlib.sha256(raw + oa_secret.encode()).hexdigest()))
    for name, mac in cands:
        if hmac.compare_digest(given, mac):
            return name
    return None


def verify_signature(raw: bytes, body: dict, header: str | None, app_id: str | None, oa_secret: str | None,
                     header_ts: str | None = None) -> bool | None:
    """Chữ ký Zalo (X-ZEvent-Signature, dạng "mac=<hex>"). None khi chưa cấu hình OA secret."""
    if not oa_secret:
        return None
    return signature_variant(raw, body, header, app_id, oa_secret, header_ts) is not None


async def record_uid(db: AsyncSession, phone: str | None, uid: str, msg_id: str | None, seen_at: datetime | None = None) -> bool:
    """Lưu/cập nhật UID cho SĐT. Trả False nếu SĐT không hợp lệ."""
    key = normalize_phone(phone)
    if len(key) < 9:
        return False
    now = seen_at or datetime.now(timezone.utc)
    stmt = insert(ZaloContactUid).values(
        phone=key, zalo_uid=uid, source="zns_webhook", last_msg_id=msg_id, first_seen_at=now, last_seen_at=now,
    ).on_conflict_do_update(
        index_elements=[ZaloContactUid.phone],
        set_={"zalo_uid": uid, "last_msg_id": msg_id, "last_seen_at": now},
    )
    await db.execute(stmt)
    return True


async def uids_for_guests(db: AsyncSession, guests: list[Guest]) -> dict[uuid.UUID, tuple[str, datetime]]:
    by_phone: dict[str, list[uuid.UUID]] = {}
    for g in guests:
        key = normalize_phone(g.phone)
        if len(key) >= 9:
            by_phone.setdefault(key, []).append(g.id)
    if not by_phone:
        return {}
    rows = (await db.execute(
        select(ZaloContactUid.phone, ZaloContactUid.zalo_uid, ZaloContactUid.last_seen_at)
        .where(ZaloContactUid.phone.in_(list(by_phone)))
    )).all()
    out: dict[uuid.UUID, tuple[str, datetime]] = {}
    for phone, uid, seen in rows:
        for gid in by_phone.get(phone, []):
            out[gid] = (uid, seen)
    return out
