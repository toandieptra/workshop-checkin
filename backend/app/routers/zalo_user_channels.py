"""Kênh Zalo cá nhân qua Smax: đồng bộ danh sách kênh zaloweb của biz, admin bật kênh được dùng + chọn mặc định."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import require_any_permission, require_permission
from ..config import settings
from ..db import get_db
from ..models import ZaloUserChannel
from ..services import smax
from ..services.zalo_sender import use_smax

router = APIRouter(prefix="/api/zalo-user", tags=["zalo-user-channels"])
SYNC_TTL = timedelta(minutes=10)


def _out(c: ZaloUserChannel) -> dict:
    return {"page_pid": c.page_pid, "name": c.name, "enabled": c.enabled, "is_default": c.is_default,
            "connection_error": c.connection_error, "synced_at": c.synced_at}


async def _sync(db: AsyncSession) -> None:
    try:
        pages = await smax.list_zaloweb_pages()
    except (smax.SmaxError, smax.SmaxRejected) as exc:
        raise HTTPException(502, str(exc)) from exc
    now = datetime.now(timezone.utc)
    seen = set()
    for p in pages:
        seen.add(p["page_pid"])
        c = await db.get(ZaloUserChannel, p["page_pid"])
        if c is None:
            c = ZaloUserChannel(page_pid=p["page_pid"], name=p["name"], enabled=False, is_default=False)
            db.add(c)
        c.name = p["name"] or c.name
        c.connection_error = p["connection_error"] or (None if p["active"] else "Kênh đang tắt trên Smax")
        c.synced_at, c.updated_at = now, now
    for c in (await db.execute(select(ZaloUserChannel))).scalars():
        if c.page_pid not in seen:
            c.connection_error, c.updated_at = "Không còn trên Smax", now
    await db.commit()


async def _list(db: AsyncSession, only_enabled: bool = False) -> list[dict]:
    stmt = select(ZaloUserChannel).order_by(ZaloUserChannel.is_default.desc(), ZaloUserChannel.enabled.desc(), ZaloUserChannel.name)
    if only_enabled:
        stmt = stmt.where(ZaloUserChannel.enabled.is_(True))
    return [_out(c) for c in (await db.execute(stmt)).scalars()]


@router.get("/status", dependencies=[Depends(require_permission("zalo_connections.read"))])
async def status(db: AsyncSession = Depends(get_db)):
    if use_smax():
        last = await db.scalar(select(ZaloUserChannel.synced_at).order_by(ZaloUserChannel.synced_at.desc().nulls_last()).limit(1))
        if not last or last < datetime.now(timezone.utc) - SYNC_TTL:
            try:
                await _sync(db)
            except HTTPException:
                pass  # vẫn trả danh sách đã lưu
    return {"provider": "smax" if use_smax() else "bridge", "smax_configured": smax.configured(),
            "biz": settings.SMAX_BIZ_ALIAS if smax.configured() else None, "channels": await _list(db)}


@router.post("/channels/sync", dependencies=[Depends(require_permission("zalo_connections.manage"))])
async def sync(db: AsyncSession = Depends(get_db)):
    if not smax.configured():
        raise HTTPException(503, "Chưa cấu hình SMAX_API_TOKEN / SMAX_BIZ_ALIAS")
    await _sync(db)
    return {"channels": await _list(db)}


class ChannelUpdate(BaseModel):
    enabled: bool | None = None
    is_default: bool | None = None


@router.put("/channels/{page_pid}", dependencies=[Depends(require_permission("zalo_connections.manage"))])
async def update_channel(page_pid: str, body: ChannelUpdate, db: AsyncSession = Depends(get_db)):
    c = await db.get(ZaloUserChannel, page_pid)
    if not c:
        raise HTTPException(404, "Không tìm thấy kênh")
    now = datetime.now(timezone.utc)
    if body.enabled is not None:
        c.enabled = body.enabled
        if not body.enabled:
            c.is_default = False
    if body.is_default:
        if c.connection_error:
            raise HTTPException(409, f"Kênh đang lỗi: {c.connection_error}")
        await db.execute(update(ZaloUserChannel).where(ZaloUserChannel.page_pid != page_pid).values(is_default=False))
        await db.flush()
        c.enabled, c.is_default = True, True
    elif body.is_default is False:
        c.is_default = False
    c.updated_at = now
    await db.commit()
    return {"channels": await _list(db)}


@router.get("/channels/enabled", dependencies=[Depends(require_any_permission("zalo_messages.read", "zalo_messages.send", "zalo_connections.read"))])
async def enabled_channels(db: AsyncSession = Depends(get_db)):
    """Cho hộp chọn kênh khi gửi tin."""
    return {"provider": "smax" if use_smax() else "bridge", "channels": await _list(db, only_enabled=True) if use_smax() else []}
