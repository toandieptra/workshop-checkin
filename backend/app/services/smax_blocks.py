"""Block Smax (Zalo User / zaloweb) — đọc qua Partner API, tạo/sửa/xoá qua API nội bộ của web Smax.

API nội bộ (đã kiểm chứng 17/11/2026, không có tài liệu chính thức — Smax đổi thì phải sửa ở đây):
- POST/PUT/DELETE /bizs/{biz}/blocks[/{id}]          {name, platform:"zaloweb", group_id}
- POST/PUT/DELETE /bizs/{biz}/cards[/{id}]           {block_id, type:"zaloweb_message", hidden_in_map, config}
  config = {text, text_html, send_queue, images[]}
- POST /bizs/{biz}/storages/uploads (multipart files, private=true) → data[].url
- GET  /bizs/{biz}/groups?type=BLOCK                  thư mục block
Xác thực bằng token đăng nhập web (SMAX_USER_TOKEN, JWT có hạn) — dán ở Cài đặt → Kết nối (smax_credentials), ưu tiên hơn .env.
"""
from __future__ import annotations

import base64
import json
import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import SmaxCredential
from . import smax

log = logging.getLogger("app.smax_blocks")
CARD_TYPE = "zaloweb_message"


async def user_token(db: AsyncSession) -> str | None:
    row = await db.get(SmaxCredential, 1)
    return (row.user_token if row and row.user_token else None) or settings.SMAX_USER_TOKEN


def token_expiry(token: str | None) -> datetime | None:
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        exp = json.loads(base64.urlsafe_b64decode(payload)).get("exp")
        if not exp:
            return None
        if exp > 1e12:  # mili-giây (giây thì < 1e12 tới năm 33658; partner token Smax có hạn tận năm 12025)
            exp /= 1000
        return datetime.fromtimestamp(exp, timezone.utc)  # quá năm 9999 → lỗi → None (coi như không hết hạn)
    except Exception:
        return None


async def _internal(db: AsyncSession, method: str, path: str, *, json_body=None, files=None, data=None, timeout: float = 30.0,
                    token: str | None = None):
    token = token or await user_token(db)
    if not token or not settings.SMAX_BIZ_ALIAS:
        raise smax.SmaxRejected("Chưa có token đăng nhập Smax (SMAX_USER_TOKEN) — dán token ở Cài đặt → Kết nối")
    exp = token_expiry(token)
    if exp and exp < datetime.now(timezone.utc):
        raise smax.SmaxRejected("Token đăng nhập Smax đã hết hạn — dán token mới ở Cài đặt → Kết nối")
    url = f"{settings.SMAX_API_URL.rstrip('/')}/bizs/{settings.SMAX_BIZ_ALIAS}{path}"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.request(method, url, json=json_body, files=files, data=data,
                                        headers={"Authorization": f"Bearer {token}"})
    except httpx.RequestError as exc:
        raise smax.SmaxError("Smax: không kết nối được") from exc
    try:
        body = resp.json() if resp.content else {}
    except ValueError:
        body = {}
    if resp.status_code < 400:
        return body.get("data") if isinstance(body, dict) else body
    msg = body.get("message") if isinstance(body, dict) else None
    if isinstance(msg, list):
        msg = "; ".join(str(m) for m in msg)
    log.warning("smax internal %s %s -> %s %s", method, path, resp.status_code, (msg or "")[:200])
    if resp.status_code == 401:
        raise smax.SmaxRejected("Token đăng nhập Smax không hợp lệ hoặc đã hết hạn")
    if resp.status_code in (400, 403, 404, 409, 422):
        raise smax.SmaxRejected(f"Smax: {msg or resp.status_code}")
    raise smax.SmaxError(f"Smax: lỗi {resp.status_code}")


# ── đọc (Partner API: token API dài hạn) ──
async def list_blocks() -> list[dict]:
    body = await smax._request("GET", "/blocks?limit=500")
    rows = body.get("data", []) if isinstance(body, dict) else []
    return [b for b in rows if b.get("platform") == "zaloweb"]


async def get_block(block_id: str) -> dict | None:
    body = await smax._request("GET", f"/blocks/{block_id}", allow404=True)
    return body.get("data") if isinstance(body, dict) else None


def message_cards(block: dict) -> list[dict]:
    """Các card "tin nhắn" Zalo User theo thứ tự hiển thị; card loại khác (kết bạn, form…) bỏ qua."""
    cards = [c for c in (block.get("cards") or []) if c.get("type") == CARD_TYPE and c.get("active", True)]
    return sorted(cards, key=lambda c: c.get("weight") or 0)


def card_view(card: dict) -> dict:
    cfg = card.get("config") or {}
    return {"id": card.get("id"), "text": cfg.get("text") or "", "images": list(cfg.get("images") or [])}


async def list_folders(db: AsyncSession) -> list[dict]:
    try:
        rows = await _internal(db, "GET", "/groups?type=BLOCK")
    except (smax.SmaxRejected, smax.SmaxError):
        return []
    return [{"id": g.get("id"), "name": g.get("name") or "", "parent_id": g.get("parent_id") or g.get("group_id")}
            for g in (rows or []) if isinstance(g, dict)]


# ── ghi (API nội bộ: token đăng nhập web) ──
def _card_config(text: str, images: list[str]) -> dict:
    return {"text": text or "", "text_html": "", "send_queue": False, "images": list(images or [])}


async def create_block(db: AsyncSession, name: str, group_id: str | None, messages: list[dict]) -> dict:
    payload = {"name": name, "platform": "zaloweb"}
    if group_id:
        payload["group_id"] = group_id
    block = await _internal(db, "POST", "/blocks", json_body=payload)
    try:
        for i, m in enumerate(messages):
            await _internal(db, "POST", "/cards", json_body={
                "block_id": block["id"], "type": CARD_TYPE, "hidden_in_map": False, "weight": i + 1,
                "config": _card_config(m.get("text", ""), m.get("images", []))})
    except Exception:
        await _internal(db, "DELETE", f"/blocks/{block['id']}")  # không để block dở dang
        raise
    return await get_block(block["id"]) or block


async def update_block(db: AsyncSession, block_id: str, name: str | None, group_id: str | None, messages: list[dict] | None) -> dict:
    current = await get_block(block_id)
    if not current or current.get("platform") != "zaloweb":
        raise smax.SmaxRejected("Không tìm thấy block Zalo User")
    meta = {}
    if name is not None:
        meta["name"] = name
    if group_id is not None:
        meta["group_id"] = group_id or None
    if meta:
        await _internal(db, "PUT", f"/blocks/{block_id}", json_body=meta)
    if messages is not None:
        existing = message_cards(current)
        for i, m in enumerate(messages):
            cfg = _card_config(m.get("text", ""), m.get("images", []))
            if i < len(existing):
                await _internal(db, "PUT", f"/cards/{existing[i]['id']}", json_body={"config": cfg, "weight": i + 1})
            else:
                await _internal(db, "POST", "/cards", json_body={"block_id": block_id, "type": CARD_TYPE,
                                                                 "hidden_in_map": False, "weight": i + 1, "config": cfg})
        for extra in existing[len(messages):]:
            await _internal(db, "DELETE", f"/cards/{extra['id']}")
    return await get_block(block_id) or current


async def delete_block(db: AsyncSession, block_id: str) -> None:
    current = await get_block(block_id)
    if not current or current.get("platform") != "zaloweb":
        raise smax.SmaxRejected("Không tìm thấy block Zalo User")
    await _internal(db, "DELETE", f"/blocks/{block_id}")


async def upload_image(db: AsyncSession, filename: str, content: bytes, mime: str) -> str:
    rows = await _internal(db, "POST", "/storages/uploads", files={"files": (filename, content, mime)},
                           data={"private": "true"}, timeout=60.0)
    item = rows[0] if isinstance(rows, list) and rows else {}
    url = item.get("url") or item.get("origin_url")
    if not url:
        raise smax.SmaxError("Smax không trả link ảnh")
    return url
