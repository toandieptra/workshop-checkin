"""Chọn nguồn gửi tin Zalo cá nhân: Smax (kênh zaloweb do admin bật) hoặc zalo-agent bridge (cũ).

- Smax được cấu hình (SMAX_API_TOKEN + SMAX_BIZ_ALIAS) và ZALO_USER_PROVIDER != "bridge" → dùng Smax.
- mapping_owner: khoá lưu ở guest_zalo_mappings. UID Zalo qua Smax dùng chung mọi kênh zaloweb → "smax".
- quota_owner: hạn mức tra SĐT / gửi tin tính theo từng tài khoản Zalo → page_pid (Smax) hoặc owner id (bridge).
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import ZaloUserChannel
from . import smax

SMAX_MAPPING_OWNER = "smax"


@dataclass(frozen=True)
class Sender:
    provider: str            # "smax" | "bridge"
    mapping_owner: str
    quota_owner: str
    page_pid: str | None = None
    name: str | None = None


def use_smax() -> bool:
    return settings.ZALO_USER_PROVIDER != "bridge" and smax.configured()


async def current_sender(db: AsyncSession, page_pid: str | None = None) -> Sender:
    if use_smax():
        stmt = select(ZaloUserChannel).where(ZaloUserChannel.enabled.is_(True))
        stmt = stmt.where(ZaloUserChannel.page_pid == page_pid) if page_pid else stmt.where(ZaloUserChannel.is_default.is_(True))
        ch = await db.scalar(stmt)
        if not ch:
            raise ValueError("Kênh Zalo (Smax) không hợp lệ hoặc chưa bật" if page_pid
                             else "Chưa chọn kênh Zalo mặc định — vào Cài đặt → Kết nối → Kênh Zalo cá nhân (Smax)")
        if ch.connection_error:
            raise ValueError(f"Kênh Zalo \"{ch.name}\" đang mất kết nối: {ch.connection_error}")
        return Sender("smax", SMAX_MAPPING_OWNER, ch.page_pid, ch.page_pid, ch.name)
    if not settings.ZALO_AGENT_ACCOUNT_OWNER_ID:
        raise ValueError("Chưa cấu hình account_owner_id")
    owner = settings.ZALO_AGENT_ACCOUNT_OWNER_ID
    return Sender("bridge", owner, owner)


async def sender_available(db: AsyncSession) -> bool:
    try:
        await current_sender(db)
        return True
    except ValueError:
        return False
