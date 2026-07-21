import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Guest
from .zbs import enqueue_registration


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def confirm_registration(
    db: AsyncSession,
    guest: Guest,
    *,
    confirmed_by: uuid.UUID | None = None,
) -> bool:
    """Confirm once and enqueue the registration ZNS in the same transaction."""
    if guest.registration_status == "confirmed":
        return False

    guest.registration_status = "confirmed"
    guest.confirmed_at = _now()
    guest.confirmed_by = confirmed_by
    guest.local_updated_at = _now()
    await enqueue_registration(db, guest)
    return True


async def apply_registration_policy(
    db: AsyncSession,
    guest: Guest,
    *,
    auto_confirm: bool,
    confirmed_by: uuid.UUID | None = None,
) -> bool:
    guest.registration_status = "pending"
    guest.confirmed_at = None
    guest.confirmed_by = None
    if not auto_confirm:
        return False
    return await confirm_registration(db, guest, confirmed_by=confirmed_by)
