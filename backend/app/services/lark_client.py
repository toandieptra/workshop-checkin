import time
import json
import logging

import httpx

from ..config import settings
from ..redis_client import get_redis

logger = logging.getLogger("lark")

_TOKEN_KEY = "lark:tenant_access_token"


class LarkError(Exception):
    pass


def _ensure_config():
    missing = [
        k for k in ("LARK_APP_ID", "LARK_APP_SECRET", "LARK_BASE_TOKEN")
        if not getattr(settings, k)
    ]
    if missing:
        raise LarkError(f"Thiếu cấu hình Lark: {', '.join(missing)}")


async def get_tenant_token() -> str:
    """Lấy tenant_access_token, cache trong Redis theo TTL."""
    _ensure_config()
    redis = get_redis()
    cached = await redis.get(_TOKEN_KEY)
    if cached:
        return cached

    url = f"{settings.lark_base_url}/auth/v3/tenant_access_token/internal"
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(url, json={
            "app_id": settings.LARK_APP_ID,
            "app_secret": settings.LARK_APP_SECRET,
        })
        r.raise_for_status()
        data = r.json()
    if data.get("code") != 0:
        raise LarkError(f"Lark auth lỗi: {data.get('msg')} (code={data.get('code')})")

    token = data["tenant_access_token"]
    expire = int(data.get("expire", 7200))
    # cache, trừ 60s buffer
    await redis.set(_TOKEN_KEY, token, ex=max(60, expire - 60))
    return token


async def _auth_headers() -> dict:
    token = await get_tenant_token()
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"}


async def list_records(table_id: str, page_size: int = 100) -> list[dict]:
    """List toàn bộ record của 1 bảng (tự phân trang)."""
    _ensure_config()
    base = settings.LARK_BASE_TOKEN
    url = f"{settings.lark_base_url}/bitable/v1/apps/{base}/tables/{table_id}/records"
    out: list[dict] = []
    page_token: str | None = None

    async with httpx.AsyncClient(timeout=60.0) as client:
        while True:
            params: dict = {"page_size": page_size}
            if page_token:
                params["page_token"] = page_token
            r = await _request_with_retry(client, "GET", url, params=params)
            data = r.json()
            if data.get("code") != 0:
                raise LarkError(f"Lark list lỗi: {data.get('msg')} (code={data.get('code')})")
            payload = data.get("data", {})
            out.extend(payload.get("items", []) or [])
            if payload.get("has_more") and payload.get("page_token"):
                page_token = payload["page_token"]
                continue
            break
    return out


async def update_record(table_id: str, record_id: str, fields: dict) -> None:
    """Cập nhật 1 record (write-back)."""
    _ensure_config()
    base = settings.LARK_BASE_TOKEN
    url = f"{settings.lark_base_url}/bitable/v1/apps/{base}/tables/{table_id}/records/{record_id}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await _request_with_retry(client, "PUT", url, json_body={"fields": fields})
        data = r.json()
        if data.get("code") != 0:
            raise LarkError(f"Lark update lỗi: {data.get('msg')} (code={data.get('code')})")


async def create_record(table_id: str, fields: dict) -> str:
    """Tạo 1 record mới, trả về record_id."""
    _ensure_config()
    base = settings.LARK_BASE_TOKEN
    url = f"{settings.lark_base_url}/bitable/v1/apps/{base}/tables/{table_id}/records"
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await _request_with_retry(client, "POST", url, json_body={"fields": fields})
        data = r.json()
        if data.get("code") != 0:
            raise LarkError(f"Lark create lỗi: {data.get('msg')} (code={data.get('code')})")
        record = data.get("data", {}).get("record", {})
        record_id = record.get("record_id")
        if not record_id:
            raise LarkError("Lark create không trả record_id")
        return record_id


async def download_bitable_media(
    file_token: str,
    table_id: str | None = None,
    extra: str | None = None,
) -> tuple[bytes, str | None]:
    """Tải attachment bitable theo file_token. Trả (bytes, content-type)."""
    _ensure_config()
    if not file_token:
        raise LarkError("Thiếu file_token")
    url = f"{settings.lark_base_url}/drive/v1/medias/{file_token}/download"
    params: dict = {}
    if extra:
        params["extra"] = extra
    elif table_id:
        params["extra"] = json.dumps({"bitablePerm": {"tableId": table_id}}, separators=(",", ":"))
    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
        r = await _request_with_retry(client, "GET", url, params=params or None)
        if r.status_code != 200 or not r.content:
            raise LarkError(f"Tải media thất bại: status={r.status_code}")
        return r.content, r.headers.get("content-type")


async def _request_with_retry(client: httpx.AsyncClient, method: str, url: str,
                              params: dict | None = None, json_body: dict | None = None,
                              max_retry: int = 2) -> httpx.Response:
    last_exc: Exception | None = None
    for attempt in range(max_retry + 1):
        headers = await _auth_headers()
        try:
            r = await client.request(method, url, params=params, json=json_body, headers=headers)
        except httpx.HTTPError as e:
            last_exc = e
            if attempt < max_retry:
                time.sleep(0.5 * (attempt + 1))
                continue
            raise
        # 429 / 5xx -> retry
        if r.status_code in (429, 500, 502, 503, 504) and attempt < max_retry:
            time.sleep(0.5 * (attempt + 1))
            continue
        # token het han -> xoa cache, thu lai
        if r.status_code == 401 and attempt < max_retry:
            await get_redis().delete(_TOKEN_KEY)
            continue
        r.raise_for_status()
        return r
    if last_exc:
        raise last_exc
    raise LarkError("Lark request thất bại")


def field_text(fields: dict, name: str) -> str | None:
    """Trích giá trị text từ field Lark (xử lý nhiều kiểu trả về)."""
    v = fields.get(name)
    if v is None:
        return None
    if isinstance(v, str):
        return v.strip() or None
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, list):
        parts = []
        for item in v:
            if isinstance(item, dict):
                parts.append(item.get("text") or item.get("name") or item.get("value") or "")
            else:
                parts.append(str(item))
        joined = " ".join(p for p in parts if p).strip()
        return joined or None
    if isinstance(v, dict):
        return v.get("text") or v.get("name") or v.get("value")
    return str(v)


def field_int(fields: dict, name: str, default: int = 1) -> int:
    """Trích số nguyên (vd Số vé đăng ký)."""
    raw = field_text(fields, name)
    if raw is None:
        return default
    digits = "".join(c for c in raw if c.isdigit())
    if not digits:
        return default
    try:
        return max(1, int(digits))
    except ValueError:
        return default
