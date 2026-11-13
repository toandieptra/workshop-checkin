"""Trang "Ghép UID Zalo": người dùng OA chưa có SĐT + gợi ý khách theo tên; xác nhận / từ chối / ghép tay / gỡ ghép."""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import current_user, require_permission
from ..config import settings
from ..db import get_db
from ..models import Guest, Workshop, ZaloContactUid, ZaloOaUser, ZaloUidSuggestion
from ..services import zalo_oa
from ..services.zbs import normalize_phone

router = APIRouter(prefix="/api/zalo-uid", tags=["zalo-uid"])


def _guest_out(g: Guest | None, ws: Workshop | None) -> dict | None:
    if not g:
        return None
    return {"id": str(g.id), "full_name": g.full_name, "phone": g.phone, "workshop_id": str(g.workshop_id),
            "workshop_name": ws.name if ws else None, "registered_at": g.registered_at or g.created_at}


def _oa_out(u: ZaloOaUser) -> dict:
    return {"user_id": u.user_id, "display_name": u.display_name, "avatar": u.avatar, "is_follower": u.is_follower,
            "last_event": u.last_event, "last_event_at": u.last_event_at, "created_at": u.created_at,
            "phone": u.phone, "phone_source": u.phone_source}


async def _sugg_out(db: AsyncSession, s: ZaloUidSuggestion) -> dict:
    g = await db.get(Guest, s.guest_id)
    ws = await db.get(Workshop, g.workshop_id) if g else None
    return {"id": str(s.id), "status": s.status, "score": s.score, "reasons": s.reasons, "phone": s.phone,
            "guest": _guest_out(g, ws), "decided_at": s.decided_at}


@router.get("/pending", dependencies=[Depends(require_permission("zbs.read"))])
async def pending(db: AsyncSession = Depends(get_db)):
    since = datetime.now(timezone.utc) - timedelta(days=30)
    users = (await db.execute(select(ZaloOaUser).where(
        ZaloOaUser.phone.is_(None), ZaloOaUser.last_event_at >= since,
    ).order_by(ZaloOaUser.last_event_at.desc()).limit(200))).scalars().all()
    out = []
    for u in users:
        sugg = (await db.execute(select(ZaloUidSuggestion).where(
            ZaloUidSuggestion.oa_user_id == u.user_id, ZaloUidSuggestion.status == "pending",
        ).order_by(ZaloUidSuggestion.score.desc()))).scalars().all()
        out.append({**_oa_out(u), "suggestions": [await _sugg_out(db, s) for s in sugg]})
    recent = (await db.execute(select(ZaloOaUser).where(
        ZaloOaUser.phone.is_not(None), ZaloOaUser.updated_at >= since,
    ).order_by(ZaloOaUser.updated_at.desc()).limit(50))).scalars().all()
    linked = []
    for u in recent:
        g = await db.scalar(select(Guest).where(
            Guest.deleted_at.is_(None),
            func.regexp_replace(Guest.phone, r"[^0-9]", "", "g").in_([u.phone, "84" + u.phone[1:]]),
        ).order_by(Guest.created_at.desc()).limit(1))
        ws = await db.get(Workshop, g.workshop_id) if g else None
        linked.append({**_oa_out(u), "guest": _guest_out(g, ws)})
    return {"name_match_enabled": settings.ZALO_UID_NAME_MATCH_ENABLED, "pending": out, "linked": linked}


async def _decide(db: AsyncSession, sid: uuid.UUID) -> ZaloUidSuggestion:
    s = await db.get(ZaloUidSuggestion, sid)
    if not s:
        raise HTTPException(404, "Không tìm thấy gợi ý")
    if s.status != "pending":
        raise HTTPException(409, "Gợi ý đã được xử lý")
    return s


@router.post("/suggestions/{sid}/confirm", dependencies=[Depends(require_permission("zbs.manage"))])
async def confirm(sid: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    s = await _decide(db, sid)
    oa = await db.get(ZaloOaUser, s.oa_user_id)
    if not oa:
        raise HTTPException(404, "Không tìm thấy người dùng OA")
    if oa.phone:
        raise HTTPException(409, "Người dùng OA này đã được ghép")
    now = datetime.now(timezone.utc)
    s.status, s.decided_by, s.decided_at = "confirmed", user.id, now
    for other in (await db.execute(select(ZaloUidSuggestion).where(
        ZaloUidSuggestion.oa_user_id == oa.user_id, ZaloUidSuggestion.status == "pending", ZaloUidSuggestion.id != s.id,
    ))).scalars().all():
        other.status, other.decided_by, other.decided_at = "rejected", user.id, now
    await zalo_oa.link_phone(db, oa, s.phone, "name_match_confirmed")
    await db.commit()
    return {"ok": True}


@router.post("/suggestions/{sid}/reject", dependencies=[Depends(require_permission("zbs.manage"))])
async def reject(sid: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    s = await _decide(db, sid)
    s.status, s.decided_by, s.decided_at = "rejected", user.id, datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True}


class LinkBody(BaseModel):
    phone: str


@router.post("/oa-users/{user_id}/link", dependencies=[Depends(require_permission("zbs.manage"))])
async def link_manual(user_id: str, body: LinkBody, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    oa = await db.get(ZaloOaUser, user_id)
    if not oa:
        raise HTTPException(404, "Không tìm thấy người dùng OA")
    phone = normalize_phone(body.phone)
    if len(phone) < 9:
        raise HTTPException(422, "Số điện thoại không hợp lệ")
    other = await db.get(ZaloContactUid, phone)
    if other and other.zalo_uid != oa.user_id:
        raise HTTPException(409, "Số điện thoại này đang gắn với UID khác — gỡ ghép trước")
    if not await zalo_oa.link_phone(db, oa, phone, "manual"):
        raise HTTPException(422, "Số điện thoại không hợp lệ")
    now = datetime.now(timezone.utc)
    for s in (await db.execute(select(ZaloUidSuggestion).where(
        ZaloUidSuggestion.oa_user_id == oa.user_id, ZaloUidSuggestion.status == "pending",
    ))).scalars().all():
        s.status, s.decided_by, s.decided_at = ("confirmed" if s.phone == phone else "rejected"), user.id, now
    await db.commit()
    return {"ok": True}


@router.post("/oa-users/{user_id}/unlink", dependencies=[Depends(require_permission("zbs.manage"))])
async def unlink(user_id: str, db: AsyncSession = Depends(get_db), user=Depends(current_user)):
    """Gỡ ghép (vd. tự ghép sai). Gợi ý đã dùng để ghép chuyển thành 'rejected' để không tự ghép lại."""
    oa = await db.get(ZaloOaUser, user_id)
    if not oa or not oa.phone:
        raise HTTPException(404, "Người dùng OA chưa được ghép")
    now = datetime.now(timezone.utc)
    await db.execute(delete(ZaloContactUid).where(ZaloContactUid.phone == oa.phone, ZaloContactUid.zalo_uid == oa.user_id))
    for s in (await db.execute(select(ZaloUidSuggestion).where(
        ZaloUidSuggestion.oa_user_id == oa.user_id, ZaloUidSuggestion.phone == oa.phone,
    ))).scalars().all():
        s.status, s.decided_by, s.decided_at = "rejected", user.id, now
    oa.phone, oa.phone_source, oa.updated_at = None, None, now
    await db.commit()
    return {"ok": True}
