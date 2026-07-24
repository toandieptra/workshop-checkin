import httpx
from fastapi import HTTPException

from ..config import settings


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
        raise HTTPException(response.status_code if response.status_code < 500 else 502, payload.get("error", "Zalo Agent Bridge báo lỗi"))
    return payload
