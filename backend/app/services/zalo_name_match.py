"""Ghép UID Zalo (người dùng OA chưa có SĐT) với khách mời bằng tên Zalo.

Luồng mỗi lượt (worker, chỉ chạy khi ZALO_UID_NAME_MATCH_ENABLED):
1. Lấy người dùng OA chưa có SĐT, có tên, tương tác trong cửa sổ ZALO_UID_MATCH_WINDOW_DAYS.
   Không có ai → dừng, KHÔNG tra cứu gì.
2. Tra tên Zalo của vài khách mới đăng ký (bridge Zalo cá nhân, theo SĐT) — tối đa
   ZALO_UID_NAME_LOOKUPS_PER_RUN mỗi lượt, ZALO_UID_NAME_LOOKUP_DAILY_CAP mỗi ngày, mỗi khách một lần.
3. So khớp tên đã chuẩn hoá. Tự ghép chỉ khi chắc chắn; còn lại tạo gợi ý cho nhân viên xác nhận.
"""
from __future__ import annotations

import asyncio
import logging
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import exists, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import (
    Guest, GuestZaloMapping, ZaloContactUid, ZaloNameLookup, ZaloOaUser, ZaloUidSuggestion, ZbsDelivery,
)
from . import zalo_oa
from .zbs import normalize_phone

log = logging.getLogger("app.zalo_name_match")

AUTO_SCORE = 0.8
MAX_SUGGESTIONS = 5
_NON_WORD = re.compile(r"[^\w\s]", re.UNICODE)


def norm_name(value: str | None) -> str:
    """Chuẩn hoá tên để so khớp: NFC, chữ thường, bỏ ký tự đặc biệt/emoji, gộp khoảng trắng. Giữ dấu tiếng Việt."""
    s = unicodedata.normalize("NFC", value or "").casefold()
    s = _NON_WORD.sub(" ", s)
    return " ".join(s.split())


def _avatar_key(url: str | None) -> str | None:
    """Phần định danh ảnh (tên file) — cùng ảnh có thể khác host/kích thước."""
    if not url:
        return None
    tail = url.split("?")[0].rstrip("/").rsplit("/", 1)[-1]
    return tail or None


@dataclass
class Candidate:
    guest: Guest
    phone: str
    name: str
    avatar: str | None
    score: float = 0.0
    reasons: list[str] = field(default_factory=list)


def score_candidate(c: Candidate, oa: ZaloOaUser, zns_recent: bool) -> Candidate:
    c.score, c.reasons = 0.5, ["Trùng tên Zalo"]
    ref = oa.created_at or oa.last_event_at or datetime.now(timezone.utc)
    reg = c.guest.registered_at or c.guest.created_at
    if reg:
        delta = ref - reg
        if timedelta(0) <= delta <= timedelta(days=3):
            c.score += 0.3
            c.reasons.append("Đăng ký trong 3 ngày trước khi tương tác OA")
        elif abs(delta) <= timedelta(days=settings.ZALO_UID_MATCH_WINDOW_DAYS):
            c.score += 0.15
            c.reasons.append(f"Đăng ký trong {settings.ZALO_UID_MATCH_WINDOW_DAYS} ngày quanh thời điểm tương tác")
    if zns_recent:
        c.score += 0.1
        c.reasons.append("Vừa nhận ZNS trước khi tương tác OA")
    a, b = _avatar_key(c.avatar), _avatar_key(oa.avatar)
    if a and b and a == b:
        c.score += 0.4
        c.reasons.append("Trùng ảnh đại diện")
    c.score = round(min(c.score, 1.5), 3)
    return c


def is_auto(cands: list[Candidate], oa: ZaloOaUser, same_name_pending: int) -> bool:
    """Tự ghép khi: đúng 1 SĐT khớp, không người dùng OA nào khác đang chờ trùng tên, và
    (trùng ảnh đại diện) hoặc (điểm ≥ AUTO_SCORE và tên có ≥ 2 chữ)."""
    if len(cands) != 1 or same_name_pending > 1:
        return False
    c = cands[0]
    if "Trùng ảnh đại diện" in c.reasons:
        return True
    return c.score >= AUTO_SCORE and len(norm_name(oa.display_name).split()) >= 2


async def pending_oa_users(db: AsyncSession) -> list[ZaloOaUser]:
    since = datetime.now(timezone.utc) - timedelta(days=settings.ZALO_UID_MATCH_WINDOW_DAYS)
    return list((await db.execute(select(ZaloOaUser).where(
        ZaloOaUser.phone.is_(None), ZaloOaUser.display_name.is_not(None), ZaloOaUser.last_event_at >= since,
    ))).scalars().all())


async def lookups_today(db: AsyncSession) -> int:
    start = datetime.now(timezone.utc) - timedelta(hours=24)
    return await db.scalar(select(func.count()).select_from(ZaloNameLookup).where(ZaloNameLookup.attempted_at >= start)) or 0


async def lookup_names(db: AsyncSession, oa_users: list[ZaloOaUser]) -> int:
    """Tra tên Zalo cho vài khách mới đăng ký chưa có tên (mỗi khách một lần). Trả số lượt đã tra."""
    from .zalo_messages import resolve_recipient

    budget = min(settings.ZALO_UID_NAME_LOOKUPS_PER_RUN, settings.ZALO_UID_NAME_LOOKUP_DAILY_CAP - await lookups_today(db))
    if budget <= 0 or not oa_users:
        return 0
    earliest = min((u.created_at for u in oa_users if u.created_at), default=datetime.now(timezone.utc))
    earliest -= timedelta(days=settings.ZALO_UID_MATCH_WINDOW_DAYS)
    linked_phones = select(ZaloContactUid.phone)
    rows = (await db.execute(
        select(Guest).where(
            Guest.deleted_at.is_(None), Guest.phone.is_not(None), Guest.created_at >= earliest,
            ~exists().where(GuestZaloMapping.guest_id == Guest.id),
            ~exists().where(ZaloNameLookup.guest_id == Guest.id),
            func.regexp_replace(Guest.phone, r"[^0-9]", "", "g").not_in(linked_phones),
        ).order_by(Guest.created_at.desc()).limit(budget * 4)
    )).scalars().all()
    done, seen_phones = 0, set()
    for guest in rows:
        if done >= budget:
            break
        key = normalize_phone(guest.phone)
        if len(key) < 9 or key in seen_phones:
            continue
        seen_phones.add(key)
        found, error = False, None
        try:
            mapping = await resolve_recipient(db, guest)
            found = bool(mapping and mapping.recipient_name)
        except Exception as exc:  # hết quota / bridge lỗi → dừng lượt này
            error = f"{type(exc).__name__}: {exc}"[:300]
        db.add(ZaloNameLookup(guest_id=guest.id, found=found, error=error))
        await db.commit()
        done += 1
        if error:
            log.warning("zalo name lookup stopped: %s", error)
            break
    return done


async def _candidates(db: AsyncSession, oa: ZaloOaUser) -> list[Candidate]:
    target = norm_name(oa.display_name)
    if not target:
        return []
    rows = (await db.execute(
        select(Guest, GuestZaloMapping).join(GuestZaloMapping, GuestZaloMapping.guest_id == Guest.id).where(
            Guest.deleted_at.is_(None), Guest.phone.is_not(None),
            func.lower(GuestZaloMapping.recipient_name) == func.lower(oa.display_name),
        )
    )).all()
    linked = {p for (p,) in (await db.execute(select(ZaloContactUid.phone).where(ZaloContactUid.zalo_uid != oa.user_id))).all()}
    by_phone: dict[str, Candidate] = {}
    for guest, mapping in rows:
        if norm_name(mapping.recipient_name) != target:
            continue
        phone = normalize_phone(guest.phone)
        if len(phone) < 9 or phone in linked:
            continue
        prev = by_phone.get(phone)
        if prev is None or (guest.created_at or datetime.min.replace(tzinfo=timezone.utc)) > (prev.guest.created_at or datetime.min.replace(tzinfo=timezone.utc)):
            avatar = (mapping.resolution or {}).get("avatar") if isinstance(mapping.resolution, dict) else None
            by_phone[phone] = Candidate(guest=guest, phone=phone, name=mapping.recipient_name or "", avatar=avatar)
    return list(by_phone.values())


async def _zns_recent(db: AsyncSession, phone: str, oa: ZaloOaUser) -> bool:
    ref = oa.created_at or datetime.now(timezone.utc)
    return bool(await db.scalar(select(func.count()).select_from(ZbsDelivery).where(
        func.regexp_replace(ZbsDelivery.phone, r"[^0-9]", "", "g").in_([phone, "84" + phone[1:]]),
        ZbsDelivery.status.in_(["sent", "delivered"]),
        ZbsDelivery.sent_time.between(ref - timedelta(days=3), ref + timedelta(minutes=5)),
    )))


async def match_user(db: AsyncSession, oa: ZaloOaUser, same_name_pending: int) -> str:
    """Trả 'auto' / 'suggested' / 'none'."""
    cands = await _candidates(db, oa)
    for c in cands:
        score_candidate(c, oa, await _zns_recent(db, c.phone, oa))
    cands.sort(key=lambda c: c.score, reverse=True)
    oa.match_checked_at = datetime.now(timezone.utc)
    if not cands:
        return "none"
    decided = {p for (p,) in (await db.execute(select(ZaloUidSuggestion.phone).where(
        ZaloUidSuggestion.oa_user_id == oa.user_id, ZaloUidSuggestion.status.in_(["rejected", "confirmed", "auto"]),
    ))).all()}
    cands = [c for c in cands if c.phone not in decided]
    if not cands:
        return "none"
    auto = is_auto(cands, oa, same_name_pending)
    for c in cands[:MAX_SUGGESTIONS]:
        stmt = insert(ZaloUidSuggestion).values(
            oa_user_id=oa.user_id, guest_id=c.guest.id, phone=c.phone, score=c.score, reasons=c.reasons,
            status="auto" if auto else "pending", decided_at=datetime.now(timezone.utc) if auto else None,
        ).on_conflict_do_update(
            constraint="uq_zalo_uid_suggestion",
            set_={"guest_id": c.guest.id, "score": c.score, "reasons": c.reasons,
                  "status": "auto" if auto else "pending",
                  "decided_at": datetime.now(timezone.utc) if auto else None},
            where=ZaloUidSuggestion.status == "pending",
        )
        await db.execute(stmt)
    if auto:
        await zalo_oa.link_phone(db, oa, cands[0].phone, "name_match_auto")
        log.info("zalo uid auto-linked by name (score=%s)", cands[0].score)
        return "auto"
    return "suggested"


async def match_all(db: AsyncSession, users: list[ZaloOaUser]) -> dict[str, int]:
    counts: dict[str, int] = {}
    names: dict[str, int] = {}
    for u in users:
        names[norm_name(u.display_name)] = names.get(norm_name(u.display_name), 0) + 1
    for u in users:
        result = await match_user(db, u, names.get(norm_name(u.display_name), 0))
        counts[result] = counts.get(result, 0) + 1
    await db.commit()
    return counts


async def run_once(db: AsyncSession) -> dict:
    users = await pending_oa_users(db)
    if not users:
        return {"pending": 0}
    looked = await lookup_names(db, users)
    users = await pending_oa_users(db)  # có thể đã được ghép trong lúc tra
    counts = await match_all(db, users)
    return {"pending": len(users), "looked_up": looked, **counts}


async def worker_loop(session_maker) -> None:
    await asyncio.sleep(30)
    while True:
        try:
            async with session_maker() as db:
                await run_once(db)
        except Exception as exc:
            log.warning("zalo name match iteration failed: %s", exc)
        await asyncio.sleep(max(30, settings.ZALO_UID_NAME_MATCH_INTERVAL_SECONDS))
