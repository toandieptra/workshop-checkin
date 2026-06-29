import redis.asyncio as aioredis
from .config import settings

_redis: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def dedup_key(workshop_id, guest_id) -> str:
    return f"{workshop_id}:{guest_id}"


async def is_duplicate(workshop_id, guest_id) -> bool:
    return bool(await get_redis().exists(dedup_key(workshop_id, guest_id)))


async def mark_checked_in(workshop_id, guest_id) -> None:
    await get_redis().set(
        dedup_key(workshop_id, guest_id), "1", ex=settings.CHECKIN_DEDUP_TTL_SECONDS
    )


async def clear_dedup(workshop_id, guest_id) -> None:
    await get_redis().delete(dedup_key(workshop_id, guest_id))
