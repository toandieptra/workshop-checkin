PERMISSIONS = frozenset({
    "workshops.read", "workshops.write", "workshops.delete",
    "guests.read", "guests.write", "guests.delete", "guests.export",
    "checkin.read", "checkin.manage",
    "registration_forms.read", "registration_forms.write",
    "lark.read", "lark.sync",
    "uploads.create",
    "zbs.read", "zbs.manage",
    "users.manage",
})

ROLE_PERMISSIONS = {
    "user": set(),
    "viewer": {
        "workshops.read", "guests.read", "checkin.read",
        "registration_forms.read", "lark.read",
    },
    "editor": {
        "workshops.read", "guests.read", "guests.write",
        "checkin.read", "checkin.manage", "registration_forms.read",
        "registration_forms.write", "uploads.create", "lark.read",
    },
    "admin": PERMISSIONS - {"users.manage"},
    "super_admin": PERMISSIONS,
}


def effective_permissions(role: str, overrides: dict | None = None) -> set[str]:
    granted = set(ROLE_PERMISSIONS.get(role, set()))
    for permission, enabled in (overrides or {}).items():
        if permission in PERMISSIONS:
            if enabled is True:
                granted.add(permission)
            elif enabled is False:
                granted.discard(permission)
    return granted


async def role_permissions(db, role: str) -> set[str]:
    """Return the persisted role grants, falling back to the code catalog."""
    from sqlalchemy import select
    from ..models import RolePermission

    stored = (await db.execute(
        select(RolePermission.permissions).where(RolePermission.role == role)
    )).scalar_one_or_none()
    if stored is None:
        return set(ROLE_PERMISSIONS.get(role, set()))
    return set(stored) & set(PERMISSIONS)


async def role_exists(db, role: str) -> bool:
    """Return whether a built-in or persisted custom role can be assigned."""
    if role in ROLE_PERMISSIONS:
        return True
    from sqlalchemy import select
    from ..models import RolePermission

    return (await db.execute(
        select(RolePermission.role).where(RolePermission.role == role)
    )).scalar_one_or_none() is not None


async def effective_permissions_for_user(db, role: str, overrides: dict | None = None) -> set[str]:
    granted = await role_permissions(db, role)
    for permission, enabled in (overrides or {}).items():
        if permission in PERMISSIONS:
            if enabled is True:
                granted.add(permission)
            elif enabled is False:
                granted.discard(permission)
    return granted
