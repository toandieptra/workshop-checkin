import httpx
import logging
from fastapi import HTTPException

from ..config import settings

log = logging.getLogger("zalo_agent")


async def bridge_request(method: str, path: str, json: dict | None = None):
    if not settings.ZALO_AGENT_BRIDGE_URL or not settings.ZALO_AGENT_BRIDGE_TOKEN:
        raise HTTPException(503, "Zalo Agent Bridge chưa được cấu hình")
    url = f"{settings.ZALO_AGENT_BRIDGE_URL.rstrip('/')}/{path.lstrip('/')}"
    try:
        async with httpx.AsyncClient(timeout=settings.ZALO_AGENT_TIMEOUT_SECONDS) as client:
            response = await client.request(
                method,
                url,
                json=json,
                headers={"Authorization": f"Bearer {settings.ZALO_AGENT_BRIDGE_TOKEN}"},
            )
    except httpx.RequestError as exc:
        raise HTTPException(503, "Không kết nối được Zalo Agent Bridge") from exc
    try:
        payload = response.json()
    except ValueError:
        payload = {"error": "Bridge trả về dữ liệu không hợp lệ"}
    if response.status_code >= 400:
        request_id = payload.get("request_id")
        detail = payload.get("error", "Zalo Agent Bridge báo lỗi")
        if request_id:
            detail = f"{detail} (request_id: {request_id})"
        log.warning("bridge_error status=%s request_id=%s detail=%s", response.status_code, request_id, detail)
        raise HTTPException(response.status_code if response.status_code < 500 else 502, detail)
    request_id = payload.get("request_id") if isinstance(payload, dict) else None
    log.info("bridge_success path=%s request_id=%s", path, request_id)
    return payload
