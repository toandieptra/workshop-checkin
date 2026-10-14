import uuid
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AdminUser, GuestNote

VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")


async def notes_summaries(db: AsyncSession, guest_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    """Ghi chú của từng khách, mỗi dòng "Người viết · giờ: nội dung", mới nhất trước."""
    if not guest_ids:
        return {}
    note_rows = (await db.execute(
        select(GuestNote.guest_id, GuestNote.content, GuestNote.created_at, AdminUser.name)
        .outerjoin(AdminUser, AdminUser.id == GuestNote.author_user_id)
        .where(GuestNote.guest_id.in_(guest_ids))
        .order_by(GuestNote.created_at.desc(), GuestNote.id.desc())
    )).all()
    notes_by_guest: dict[uuid.UUID, list[str]] = {}
    for guest_id, content, created_at, author_name in note_rows:
        author = (author_name or "—").strip() or "—"
        if created_at is not None:
            local_dt = created_at.astimezone(VN_TZ) if created_at.tzinfo else created_at.replace(tzinfo=VN_TZ)
            time_str = f"{local_dt.strftime('%H:%M:%S')} {local_dt.day}/{local_dt.month}/{local_dt.year}"
        else:
            time_str = "—"
        notes_by_guest.setdefault(guest_id, []).append(f"{author} · {time_str}: {content}")
    return {guest_id: "\n".join(lines) for guest_id, lines in notes_by_guest.items()}
