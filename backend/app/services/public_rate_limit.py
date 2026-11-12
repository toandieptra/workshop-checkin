"""Rate limit Redis cho endpoint công khai (survey). Khoá chỉ chứa hash, không chứa PII."""
import hashlib
import ipaddress

from fastapi import HTTPException, Request

from ..redis_client import get_redis

_INCR_SCRIPT = """
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return current
"""


def client_address(request: Request) -> str:
    """IP khách: nginx ghi đè X-Real-IP bằng $remote_addr, nên chỉ tin header này khi
    request đến từ proxy trong mạng nội bộ (container nginx/frontend, loopback)."""
    peer = request.client.host if request.client else ""
    try:
        trusted_peer = ipaddress.ip_address(peer).is_private
    except ValueError:
        trusted_peer = False
    real_ip = (request.headers.get("x-real-ip") or "").strip()
    if trusted_peer and real_ip:
        return real_ip
    return peer or "unknown"


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:32]


async def hit(bucket: str, subject: str, limit: int, window_seconds: int) -> None:
    key = f"rl:{bucket}:{_digest(subject)}"
    try:
        count = int(await get_redis().eval(_INCR_SCRIPT, 1, key, window_seconds))
    except Exception as exc:  # Redis lỗi: từ chối thay vì mở toang endpoint công khai.
        raise HTTPException(503, "Hệ thống đang bận, vui lòng thử lại sau ít phút.") from exc
    if count > limit:
        raise HTTPException(
            429,
            "Anh/chị thao tác hơi nhanh — vui lòng thử lại sau ít phút.",
            headers={"Retry-After": str(window_seconds)},
        )
