from datetime import datetime, timezone
import uuid

from app.models import Guest
from scripts.backfill_guest_creators import build_assignments


def guest(name: str, registered_at: datetime, guest_id: str) -> Guest:
    return Guest(
        id=uuid.UUID(guest_id),
        workshop_id=uuid.uuid4(),
        full_name=name,
        registered_at=registered_at,
    )


def test_build_assignments_numbers_guests_by_registration_time_then_id():
    same_time = datetime(2026, 7, 20, tzinfo=timezone.utc)
    later = datetime(2026, 7, 21, tzinfo=timezone.utc)
    guests = [
        guest("Later", later, "00000000-0000-0000-0000-000000000003"),
        guest("Second", same_time, "00000000-0000-0000-0000-000000000002"),
        guest("First", same_time, "00000000-0000-0000-0000-000000000001"),
    ]

    assignments = build_assignments(guests)

    assert [item.full_name for item in assignments] == ["First", "Second", "Later"]
    assert [item.creator_name for item in assignments] == [
        "Người dùng 1001",
        "Người dùng 1002",
        "Người dùng 1003",
    ]
