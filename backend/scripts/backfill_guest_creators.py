import argparse
import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
import sys
from pathlib import Path
import uuid

from sqlalchemy import delete, select, text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app.db import SessionLocal
from app.models import Guest, GuestCreatorAlias
from app.services import lark_client


LEGACY_CREATOR = "Người dùng 1001"
FIRST_ALIAS = 1001


@dataclass(frozen=True)
class Assignment:
    guest_id: uuid.UUID
    full_name: str
    phone: str | None
    lark_record_id: str | None
    creator_name: str


def build_assignments(guests: list[Guest]) -> list[Assignment]:
    ordered = sorted(
        guests,
        key=lambda guest: (
            guest.registered_at or guest.created_at or datetime.min.replace(tzinfo=timezone.utc),
            str(guest.id),
        ),
    )
    return [
        Assignment(
            guest_id=guest.id,
            full_name=guest.full_name,
            phone=guest.phone,
            lark_record_id=guest.lark_record_id,
            creator_name=f"Người dùng {FIRST_ALIAS + index}",
        )
        for index, guest in enumerate(ordered)
    ]


async def run(apply: bool) -> int:
    async with SessionLocal() as db:
        legacy_alias_exists = (await db.execute(
            select(GuestCreatorAlias.alias_number).where(
                GuestCreatorAlias.alias_number == FIRST_ALIAS
            )
        )).scalar_one_or_none() is not None
        guests = (await db.execute(
            select(Guest).where(Guest.creator_name == LEGACY_CREATOR)
        )).scalars().all()
        assignments = build_assignments(list(guests))

        print(f"Found {len(assignments)} guest(s) with creator {LEGACY_CREATOR!r}.")
        for item in assignments:
            print(
                f"{item.guest_id} | {item.full_name} | {item.phone or '-'} | "
                f"{item.lark_record_id or 'MISSING_LARK_RECORD'} | {item.creator_name}"
            )

        if not apply:
            print("Dry run only. Re-run with --apply after reviewing this mapping.")
            return 0
        if not assignments:
            return 0
        if not legacy_alias_exists:
            print("Legacy alias 1001 is absent; this backfill appears to be already applied.")
            return 0
        if not settings.LARK_TABLE_REGISTRATIONS:
            print("LARK_TABLE_REGISTRATIONS is not configured.", file=sys.stderr)
            return 1

        missing = [item for item in assignments if not item.lark_record_id]
        if missing:
            print(
                f"Refusing to apply: {len(missing)} guest(s) have no lark_record_id.",
                file=sys.stderr,
            )
            return 1

        try:
            for item in assignments:
                await lark_client.update_record(
                    settings.LARK_TABLE_REGISTRATIONS,
                    item.lark_record_id,
                    {"Người tạo Web": item.creator_name},
                )

            now = datetime.now(timezone.utc)
            guests_by_id = {guest.id: guest for guest in guests}
            for item in assignments:
                guest = guests_by_id[item.guest_id]
                guest.creator_name = item.creator_name
                guest.sync_status = "synced"
                guest.last_synced_at = now
                guest.sync_error = None

            highest_alias = FIRST_ALIAS + len(assignments) - 1
            await db.execute(delete(GuestCreatorAlias).where(
                GuestCreatorAlias.alias_number == FIRST_ALIAS
            ))
            await db.execute(text(
                "SELECT setval(pg_get_serial_sequence('guest_creator_aliases', "
                "'alias_number'), :value, true)"
            ), {"value": highest_alias})
            await db.commit()
        except Exception as exc:
            await db.rollback()
            print(f"Backfill failed: {exc}", file=sys.stderr)
            return 1

        print(f"Updated {len(assignments)} guest(s); next IP alias starts after {highest_alias}.")
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Renumber legacy guest creators and update Người tạo Web in Lark.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply changes. Without this flag the command is read-only.",
    )
    args = parser.parse_args()
    return asyncio.run(run(args.apply))


if __name__ == "__main__":
    raise SystemExit(main())
