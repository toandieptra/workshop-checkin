from app.auth.permissions import PERMISSIONS, effective_permissions


def test_super_admin_has_complete_catalog():
    assert effective_permissions("super_admin") == set(PERMISSIONS)


def test_permission_overrides_grant_and_revoke():
    permissions = effective_permissions("viewer", {
        "workshops.read": False,
        "guests.write": True,
        "not.real": True,
    })
    assert "workshops.read" not in permissions
    assert "guests.write" in permissions
    assert "not.real" not in permissions


def test_admin_cannot_manage_users_by_default():
    assert "users.manage" not in effective_permissions("admin")


def test_user_cannot_access_admin_and_editor_cannot_manage_users():
    assert effective_permissions("user") == set()
    assert "guests.write" in effective_permissions("editor")
    assert "users.manage" not in effective_permissions("editor")
