"""Sự kiện OA (Zalo Official Account) → UID người dùng, ghép với SĐT khách mời.

- Sự kiện có UID: follow/unfollow (follower.id), user_send_* / user_submit_info / user_click_* (sender.id),
  tin OA gửi tới người dùng: user_received_message, user_seen_message, oa_send_* (recipient.id).
- Sự kiện OA KHÔNG có SĐT. SĐT chỉ có khi khách chủ động chia sẻ thông tin cho OA:
  user_submit_info.info.phone, hoặc API "thông tin người dùng" trả data.shared_info.phone.
- Không lưu nội dung tin nhắn của khách.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import ZaloOaUser
from . import zalo_uid
from .zbs import normalize_phone

log = logging.getLogger("app.zalo_oa")

FROM_USER_PREFIXES = ("user_send_", "user_click_", "user_reacted_", "user_submit_info", "user_asking_product",
                      "user_call_oa", "user_feedback")
TO_USER_EVENTS = {"user_received_message", "user_seen_message"}
FOLLOW_EVENTS = {"follow", "unfollow"}
DETAIL_NOW_EVENTS = {"follow", "user_submit_info"}


@dataclass
class OaUserEvent:
    event_name: str
    user_id: str
    user_id_by_app: str | None
    at: datetime
    phone: str | None = None          # từ user_submit_info
    name: str | None = None
    follow: bool | None = None        # True follow / False unfollow


def _s(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _id(obj) -> str | None:
    return _s(obj.get("id")) if isinstance(obj, dict) else None


def extract_user_event(body: dict, server: str | None) -> OaUserEvent | None:
    """UID người dùng từ một sự kiện OA; None nếu không phải sự kiện OA mang UID (vd. biên nhận ZNS qua SĐT)."""
    if (server or "").strip().upper() == "ZNS":
        return None
    name = _s(body.get("event_name"))
    if not name:
        return None
    uid: str | None = None
    follow = None
    if name in FOLLOW_EVENTS:
        uid, follow = _id(body.get("follower")), name == "follow"
    elif name.startswith(FROM_USER_PREFIXES):
        uid = _id(body.get("sender"))
    elif name in TO_USER_EVENTS or name.startswith("oa_send_"):
        uid = _id(body.get("recipient"))
    if not uid or zalo_uid.looks_like_phone(uid):
        return None
    oa_id = _s(body.get("oa_id"))
    if oa_id and uid == oa_id:
        return None
    ts = zalo_uid._ts(body.get("timestamp")) or datetime.now(timezone.utc)
    phone = name_ = None
    if name == "user_submit_info" and isinstance(body.get("info"), dict):
        phone = _s(body["info"].get("phone"))
        name_ = _s(body["info"].get("name"))
    return OaUserEvent(event_name=name, user_id=uid, user_id_by_app=_s(body.get("user_id_by_app")), at=ts,
                       phone=phone, name=name_, follow=follow)


async def _link_phone(db: AsyncSession, user: ZaloOaUser, phone: str | None, source: str) -> bool:
    key = normalize_phone(phone)
    if len(key) < 9:
        return False
    user.phone, user.phone_source = key, source
    await zalo_uid.record_uid(db, key, user.user_id, None, datetime.now(timezone.utc),
                              uid_by_app=user.user_id_by_app, source=source)
    return True


async def record_event(db: AsyncSession, ev: OaUserEvent) -> tuple[ZaloOaUser, bool]:
    """Ghi/cập nhật người dùng OA. Trả (user, cần_gọi_API_thông_tin)."""
    now = datetime.now(timezone.utc)
    user = await db.get(ZaloOaUser, ev.user_id)
    if user is None:
        user = ZaloOaUser(user_id=ev.user_id, created_at=now)
        db.add(user)
    user.user_id_by_app = ev.user_id_by_app or user.user_id_by_app
    user.last_event, user.last_event_at, user.updated_at = ev.event_name, ev.at, now
    if ev.follow is not None:
        user.is_follower = ev.follow
    if ev.name and not user.display_name:
        user.display_name = ev.name
    if ev.phone:
        await _link_phone(db, user, ev.phone, "oa_submit_info")
    stale = user.detail_checked_at is None or user.detail_checked_at < now - timedelta(hours=settings.ZBS_OA_DETAIL_REFRESH_HOURS)
    need_detail = ev.event_name in DETAIL_NOW_EVENTS or (stale and not user.phone)
    if ev.event_name == "unfollow":
        need_detail = False
    return user, need_detail


async def fetch_user_detail(db: AsyncSession, user_id: str) -> dict:
    """API OA "thông tin người dùng". Trả data (rỗng nếu lỗi) và ghi nhận kết quả vào zalo_oa_users."""
    from .zbs_auth import request_with_token

    user = await db.get(ZaloOaUser, user_id)
    if user is None:
        return {}
    now = datetime.now(timezone.utc)
    user.detail_checked_at = now
    try:
        async with httpx.AsyncClient(timeout=settings.ZBS_REQUEST_TIMEOUT_SECONDS) as client:
            resp = await request_with_token(db, client, "GET", f"{settings.ZBS_OA_API_URL}/user/detail",
                                            params={"data": json.dumps({"user_id": user_id})})
        payload = resp.json() if resp.content else {}
    except Exception as exc:  # mạng / token
        user.detail_error = f"{type(exc).__name__}: {exc}"[:300]
        await db.commit()
        return {}
    if payload.get("error") not in (0, None):
        user.detail_error = f"{payload.get('error')}: {payload.get('message')}"[:300]
        await db.commit()
        return {}
    data = payload.get("data") or {}
    user.detail_error = None
    user.display_name = _s(data.get("display_name")) or user.display_name
    user.user_id_by_app = _s(data.get("user_id_by_app")) or user.user_id_by_app
    if data.get("user_is_follower") is not None:
        user.is_follower = bool(data.get("user_is_follower"))
    shared = data.get("shared_info") if isinstance(data.get("shared_info"), dict) else {}
    if shared.get("phone"):
        await _link_phone(db, user, shared.get("phone"), "oa_user_detail")
    user.updated_at = now
    await db.commit()
    return data


async def refresh_detail_task(user_id: str) -> None:
    """Chạy nền sau khi trả 200 cho Zalo (webhook phải phản hồi nhanh)."""
    from ..db import async_session_maker

    if not settings.ZBS_ENABLED:
        # Local/dev: không gọi API Zalo (token OAuth trong DB có thể là bản sao production — làm mới ở đây
        # sẽ xoay vòng refresh token và làm hỏng token production).
        return
    try:
        async with async_session_maker() as db:
            await fetch_user_detail(db, user_id)
    except Exception as exc:
        log.warning("zalo oa user detail failed: %s", exc)
