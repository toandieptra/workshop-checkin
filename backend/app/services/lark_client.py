import time
import logging

import httpx

from ..config import settings
from ..redis_client import get_redis

logger = logging.getLogger("lark")

_TOKEN_KEY = "lark:tenant_access_token"


class LarkError(Exception):
    pass


def _ensure_app_config():
    missing = [
        key for key in ("LARK_APP_ID", "LARK_APP_SECRET")
        if not getattr(settings, key)
    ]
    if missing:
        raise LarkError(f"Thiếu cấu hình Lark: {', '.join(missing)}")


async def get_tenant_token() -> str:
    """Lấy tenant_access_token, cache trong Redis theo TTL."""
    _ensure_app_config()
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


async def _list_contact_pages(url: str, params: dict) -> list[dict]:
    """List a paginated Lark Contacts endpoint (maximum page size is 50)."""
    out: list[dict] = []
    page_token: str | None = None
    async with httpx.AsyncClient(timeout=60.0) as client:
        while True:
            page_params = {**params, "page_size": 50}
            if page_token:
                page_params["page_token"] = page_token
            response = await _request_with_retry(client, "GET", url, params=page_params)
            data = response.json()
            if data.get("code") != 0:
                raise LarkError(f"Lark Contacts lỗi: {data.get('msg')} (code={data.get('code')})")
            payload = data.get("data") or {}
            out.extend(payload.get("items") or [])
            if payload.get("has_more") and payload.get("page_token"):
                page_token = payload["page_token"]
                continue
            return out


async def list_contact_departments() -> list[dict]:
    """List every department visible to the app, recursively from root."""
    _ensure_app_config()
    url = f"{settings.lark_base_url}/contact/v3/departments/0/children"
    return await _list_contact_pages(url, {
        "department_id_type": "open_department_id",
        "user_id_type": "user_id",
        "fetch_child": "true",
    })


async def list_contact_users_by_department(department_id: str) -> list[dict]:
    """List users directly under one department."""
    _ensure_app_config()
    url = f"{settings.lark_base_url}/contact/v3/users/find_by_department"
    return await _list_contact_pages(url, {
        "department_id": department_id,
        "department_id_type": "open_department_id",
        "user_id_type": "user_id",
    })


async def list_contact_users() -> list[dict]:
    """List unique users across root and all visible departments."""
    departments = await list_contact_departments()
    department_ids = ["0"]
    department_ids.extend(
        str(item.get("open_department_id") or item.get("department_id"))
        for item in departments
        if item.get("open_department_id") or item.get("department_id")
    )
    unique: dict[str, dict] = {}
    for department_id in dict.fromkeys(department_ids):
        for user in await list_contact_users_by_department(department_id):
            key = str(
                user.get("union_id") or user.get("open_id") or user.get("user_id")
                or user.get("enterprise_email") or user.get("email") or ""
            ).strip().lower()
            if key:
                unique[key] = user
    return list(unique.values())


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
