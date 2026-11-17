"""Smax Partner API — kênh Zalo cá nhân (zaloweb) của biz Smax (vd. "dieptra").

Cùng cách POS (hisweetie_ban_hang_backend/src/smax/smax-api.service.ts):
- Tra Zalo theo SĐT: GET /partner/bizs/{biz}/pages/{pid}/friend?phone=84xxxxxxxxx → uid + display_name.
- Gửi: POST /partner/bizs/{biz}/pages/{pid}/zaloweb-messages {uid, message | images[] | file}.
  Chữ KHÔNG gửi kèm images (Smax bỏ mất chữ) → tách lượt; media phải là URL https công khai.
"""
from __future__ import annotations

import logging
import re

import httpx

from ..config import settings

log = logging.getLogger("app.smax")


class SmaxError(Exception):
    """Lỗi tạm thời / không rõ kết quả (mạng, 5xx, 429) — có thể thử lại."""


class SmaxAmbiguousError(SmaxError):
    """Gửi có thể đã tới khách (timeout / 5xx khi gửi) — không tự gửi lại để tránh trùng."""


class SmaxRejected(ValueError):
    """Smax/Zalo từ chối có lý do (400/422/401/403) — thử lại không giúp."""


# Partner token dán ở Cài đặt → Kết nối (bảng smax_credentials) — nạp lúc khởi động và khi lưu, ưu tiên hơn .env.
_db_api_token: str | None = None


def set_db_api_token(token: str | None) -> None:
    global _db_api_token
    _db_api_token = token or None


async def load_db_tokens(db) -> None:
    from ..models import SmaxCredential
    row = await db.get(SmaxCredential, 1)
    set_db_api_token(row.api_token if row else None)


def api_token() -> str | None:
    return _db_api_token or settings.SMAX_API_TOKEN


def api_token_source() -> str | None:
    return "db" if _db_api_token else ("env" if settings.SMAX_API_TOKEN else None)


def configured() -> bool:
    return bool(api_token() and settings.SMAX_BIZ_ALIAS)


def phone84(phone: str | None) -> str | None:
    """SĐT VN đầu tiên trong chuỗi → 84xxxxxxxxx (Zalo báo "không hợp lệ" với số 0 đầu)."""
    compact = re.sub(r"[\s\-().]", "", phone or "")
    m = re.search(r"(?:\+?84|0)(\d{9})(?!\d)", compact)
    return f"84{m.group(1)}" if m else None


async def _request(method: str, path: str, json: dict | None = None, *, timeout: float = 15.0,
                   allow404: bool = False, sending: bool = False, token: str | None = None):
    token = token or api_token()
    if not (token and settings.SMAX_BIZ_ALIAS):
        raise SmaxRejected("Chưa cấu hình Partner API token Smax — dán ở Cài đặt → Kết nối")
    url = f"{settings.SMAX_API_URL.rstrip('/')}/partner/bizs/{settings.SMAX_BIZ_ALIAS}{path}"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.request(method, url, json=json, headers={"Authorization": f"Bearer {token}"})
    except httpx.TimeoutException as exc:
        if sending:
            raise SmaxAmbiguousError("Smax: hết thời gian chờ — tin có thể đã gửi") from exc
        raise SmaxError("Smax: hết thời gian chờ") from exc
    except httpx.RequestError as exc:
        raise SmaxError("Smax: không kết nối được") from exc
    if resp.status_code == 404 and allow404:
        return None
    try:
        body = resp.json() if resp.content else {}
    except ValueError:
        body = {}
    if resp.status_code < 400:
        return body
    msg = body.get("message") if isinstance(body, dict) else None
    log.warning("smax %s %s -> %s %s", method, path.split("?")[0], resp.status_code, (msg or "")[:200])
    if resp.status_code in (400, 422) and isinstance(msg, str) and msg.strip():
        raise SmaxRejected(f"Zalo: {msg.strip()}")
    if resp.status_code == 401:
        raise SmaxRejected("Smax: token không hợp lệ hoặc đã hết hạn")
    if resp.status_code == 403:
        raise SmaxRejected("Smax: token không có quyền")
    if resp.status_code == 429:
        raise SmaxError("Smax: gọi API quá nhiều, thử lại sau")
    if sending and resp.status_code >= 500:
        # Smax đôi khi trả 5xx dù tin đã tới khách (ghi chú của POS) → không tự gửi lại
        raise SmaxAmbiguousError(f"Smax: lỗi {resp.status_code} — tin có thể đã gửi")
    raise SmaxError(f"Smax: lỗi {resp.status_code}")


async def list_zaloweb_pages() -> list[dict]:
    body = await _request("GET", "/pages")
    data = body.get("data", body) if isinstance(body, dict) else body
    if isinstance(data, dict):
        data = data.get("data", [])
    out = []
    for p in data or []:
        if p.get("platform") != "zaloweb":
            continue
        members = p.get("members") or []
        broken = members and all(m.get("access_token_error") for m in members)
        note = next((m.get("access_token_error_note") for m in members if m.get("access_token_error_note")), None)
        out.append({"page_pid": str(p.get("pid") or p.get("page_pid")), "name": p.get("name") or "",
                    "active": bool(p.get("active", True)),
                    "connection_error": (note or "Kênh mất kết nối Zalo") if broken else None})
    return out


async def find_friend(page_pid: str, phone: str | None) -> dict | None:
    """Tra người dùng Zalo theo SĐT từ kênh zaloweb; None nếu SĐT không có Zalo / ẩn tìm kiếm / không hợp lệ."""
    p84 = phone84(phone)
    if not p84:
        return None
    body = await _request("GET", f"/pages/{page_pid}/friend?phone={p84}", allow404=True)
    if not body:
        return None
    data = body.get("data") if isinstance(body, dict) else None
    result = (data or {}).get("decodedData") if isinstance(data, dict) and "decodedData" in data else data
    if isinstance(result, dict) and result.get("error_code") not in (None, 0):
        return None
    f = result.get("data", result) if isinstance(result, dict) else None
    uid = (f or {}).get("uid") or (f or {}).get("userId") or (f or {}).get("id")
    if not uid:
        return None
    name = f.get("display_name") or f.get("zalo_name") or f.get("zaloName") or f.get("name") or ""
    return {"uid": str(uid), "display_name": name, "avatar": f.get("avatar")}


async def send_zaloweb(page_pid: str, uid: str, content: dict) -> dict:
    only_text = set(content) == {"message"}
    return await _request("POST", f"/pages/{page_pid}/zaloweb-messages", {"uid": uid, **content},
                          timeout=15.0 if only_text else 60.0, sending=True) or {}


def message_id(resp: dict) -> str | None:
    d = resp.get("data") if isinstance(resp, dict) else None
    for src in (d if isinstance(d, dict) else {}, resp if isinstance(resp, dict) else {}):
        for k in ("msgId", "msg_id", "message_id", "pid", "id"):
            if src.get(k):
                return str(src[k])
    return None
