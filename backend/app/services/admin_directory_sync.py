import logging
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AdminDirectorySyncState, AdminSession, AdminUser
from . import lark_client

logger = logging.getLogger("lark.directory")


@dataclass
class DirectorySyncResult:
    status: str = "success"
    users_seen: int = 0
    users_created: int = 0
    users_updated: int = 0
    users_deactivated: int = 0
    users_skipped: int = 0


def normalize_email(value: object) -> str | None:
    email = str(value or "").strip().lower()
    return email if email and "@" in email else None


def account_status(status: object) -> tuple[str, bool | None, bool | None, bool | None]:
    data = status if isinstance(status, dict) else {}
    activated = data.get("is_activated") if isinstance(data.get("is_activated"), bool) else None
    frozen = data.get("is_frozen") if isinstance(data.get("is_frozen"), bool) else None
    resigned = data.get("is_resigned") if isinstance(data.get("is_resigned"), bool) else None
    if resigned is True:
        return "resigned", activated, frozen, resigned
    if frozen is True:
        return "frozen", activated, frozen, resigned
    if activated is False:
        return "inactive", activated, frozen, resigned
    if activated is True and frozen is not True and resigned is not True:
        return "active", activated, frozen, resigned
    return "unknown", activated, frozen, resigned


def status_payload(state: AdminDirectorySyncState | None) -> dict:
    if not state:
        return {
            "status": "never", "started_at": None, "finished_at": None,
            "users_seen": 0, "users_created": 0, "users_updated": 0,
            "users_deactivated": 0, "users_skipped": 0, "error": None,
        }
    return {
        "status": state.status, "started_at": state.started_at, "finished_at": state.finished_at,
        "users_seen": state.users_seen, "users_created": state.users_created,
        "users_updated": state.users_updated, "users_deactivated": state.users_deactivated,
        "users_skipped": state.users_skipped, "error": state.error,
    }


async def get_sync_state(db: AsyncSession) -> AdminDirectorySyncState | None:
    return await db.get(AdminDirectorySyncState, 1)


async def _find_user(db: AsyncSession, item: dict, email: str | None) -> tuple[AdminUser | None, bool]:
    union_id = str(item.get("union_id") or "").strip() or None
    open_id = str(item.get("open_id") or "").strip() or None
    user_id = str(item.get("user_id") or "").strip() or None
    identity_conditions = []
    if union_id:
        identity_conditions.append(AdminUser.lark_union_id == union_id)
    if open_id:
        identity_conditions.append(AdminUser.lark_open_id == open_id)
    if user_id:
        identity_conditions.append(AdminUser.lark_user_id == user_id)
    if identity_conditions:
        matches = (await db.execute(select(AdminUser).where(or_(*identity_conditions)))).scalars().all()
        if len(matches) > 1:
            logger.warning("Conflicting Lark identities for directory user %s", user_id or open_id or union_id)
            return None, True
        if matches:
            return matches[0], False
    if email:
        email_user = (await db.execute(
            select(AdminUser).where(func.lower(AdminUser.email) == email)
        )).scalar_one_or_none()
        if email_user:
            conflicts = (
                (union_id and email_user.lark_union_id and email_user.lark_union_id != union_id)
                or (open_id and email_user.lark_open_id and email_user.lark_open_id != open_id)
                or (user_id and email_user.lark_user_id and email_user.lark_user_id != user_id)
            )
            if conflicts:
                logger.warning("Refusing to merge conflicting Lark identity for email %s", email)
                return None, True
        return email_user, False
    return None, False


async def sync_directory(db: AsyncSession) -> DirectorySyncResult:
    now = datetime.now(timezone.utc)
    state = await get_sync_state(db) or AdminDirectorySyncState(id=1)
    state.status = "running"
    state.started_at = now
    state.finished_at = None
    state.error = None
    db.add(state)
    await db.commit()

    result = DirectorySyncResult()
    try:
        directory_users = await lark_client.list_contact_users()
        result.users_seen = len(directory_users)
        for item in directory_users:
            email = normalize_email(item.get("enterprise_email") or item.get("email"))
            user, identity_conflict = await _find_user(db, item, email)
            if identity_conflict:
                result.users_skipped += 1
                continue
            if not user and not email:
                result.users_skipped += 1
                continue
            if not user:
                user = AdminUser(email=email, role="user", is_active=False, permission_overrides={})
                db.add(user)
                result.users_created += 1
            else:
                result.users_updated += 1

            status_name, activated, frozen, resigned = account_status(item.get("status"))
            enterprise_email = normalize_email(item.get("enterprise_email"))
            user.name = item.get("name") or item.get("en_name") or user.name
            avatar = item.get("avatar") if isinstance(item.get("avatar"), dict) else {}
            user.avatar_url = avatar.get("avatar_240") or avatar.get("avatar_72") or user.avatar_url
            user.enterprise_email = enterprise_email or user.enterprise_email
            user.lark_open_id = item.get("open_id") or user.lark_open_id
            user.lark_union_id = item.get("union_id") or user.lark_union_id
            user.lark_user_id = item.get("user_id") or user.lark_user_id
            user.lark_account_status = status_name
            user.lark_is_activated = activated
            user.lark_is_frozen = frozen
            user.lark_is_resigned = resigned
            user.lark_last_synced_at = now
            user.updated_at = now

            if status_name in {"inactive", "frozen", "resigned"} and user.role != "super_admin" and user.is_active:
                user.is_active = False
                await db.flush()
                await db.execute(delete(AdminSession).where(AdminSession.user_id == user.id))
                result.users_deactivated += 1

        state.status = "success"
        state.finished_at = datetime.now(timezone.utc)
        for key, value in asdict(result).items():
            if key != "status":
                setattr(state, key, value)
        await db.commit()
        return result
    except Exception as exc:
        await db.rollback()
        state = await get_sync_state(db) or AdminDirectorySyncState(id=1)
        state.status = "error"
        state.finished_at = datetime.now(timezone.utc)
        state.error = str(exc)[:2000]
        db.add(state)
        await db.commit()
        raise
