import hashlib
import json
import secrets
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, Response
from fastapi.security import APIKeyHeader
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_db
from ..models import ApiKey
from ..redis_client import get_redis


PUBLIC_API_SCOPES = frozenset({
    "workshops.read",
    "guests.read",
    "guests.write",
    "checkin.read",
    "checkin.manage",
    "registration_forms.read",
    "registration_forms.write",
})

api_key_header = APIKeyHeader(name="X-API-Key", scheme_name="ApiKeyAuth", auto_error=False)


@dataclass(frozen=True)
class ApiKeyPrincipal:
    id: uuid.UUID
    name: str
    scopes: frozenset[str]
    rate_limit: int


def hash_api_key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def generate_api_key() -> tuple[str, str, str]:
    raw = f"wk_live_{secrets.token_urlsafe(32)}"
    return raw, hash_api_key(raw), raw[:16]


async def authenticate_api_key(
    request: Request,
    response: Response,
    raw_key: Annotated[str | None, Depends(api_key_header)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiKeyPrincipal:
    if not settings.PUBLIC_API_ENABLED:
        raise HTTPException(503, "public API is disabled")
    if not raw_key:
        raise HTTPException(401, "API key is required", headers={"WWW-Authenticate": "ApiKey"})

    record = (await db.execute(
        select(ApiKey).where(ApiKey.key_hash == hash_api_key(raw_key))
    )).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if not record or not record.is_active or (record.expires_at and record.expires_at <= now):
        raise HTTPException(401, "API key is invalid or expired", headers={"WWW-Authenticate": "ApiKey"})

    limit = record.rate_limit or settings.PUBLIC_API_RATE_LIMIT_PER_MINUTE
    window = int(time.time() // 60)
    redis_key = f"public:ratelimit:{record.id}:{window}"
    redis = get_redis()
    count = await redis.incr(redis_key)
    if count == 1:
        await redis.expire(redis_key, 60)
    reset = (window + 1) * 60
    response.headers["X-RateLimit-Limit"] = str(limit)
    response.headers["X-RateLimit-Remaining"] = str(max(0, limit - count))
    response.headers["X-RateLimit-Reset"] = str(reset)
    if count > limit:
        raise HTTPException(429, "rate limit exceeded", headers={
            "Retry-After": str(max(1, reset - int(time.time()))),
            "X-RateLimit-Limit": str(limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": str(reset),
        })

    record.last_used_at = now
    await db.commit()
    return ApiKeyPrincipal(record.id, record.name, frozenset(record.scopes), limit)


ApiKeyDep = Annotated[ApiKeyPrincipal, Depends(authenticate_api_key)]


def require_api_scope(scope: str):
    async def dependency(principal: ApiKeyDep) -> ApiKeyPrincipal:
        if scope not in principal.scopes:
            raise HTTPException(403, f"API key requires scope: {scope}")
        return principal

    return dependency


async def load_idempotent_response(principal: ApiKeyPrincipal, route: str, key: str | None) -> dict | None:
    if not key:
        return None
    value = await get_redis().get(f"public:idempotency:{principal.id}:{route}:{key}")
    return json.loads(value) if value else None


async def save_idempotent_response(principal: ApiKeyPrincipal, route: str, key: str | None, payload: dict) -> None:
    if not key:
        return
    await get_redis().set(
        f"public:idempotency:{principal.id}:{route}:{key}",
        json.dumps(payload, default=str),
        ex=settings.PUBLIC_API_IDEMPOTENCY_TTL_SECONDS,
        nx=True,
    )


IdempotencyKey = Annotated[str | None, Header(alias="Idempotency-Key", max_length=200)]
