from app.services.admin_directory_sync import account_status, normalize_email


def test_normalize_email():
    assert normalize_email(" USER@Example.COM ") == "user@example.com"
    assert normalize_email("") is None
    assert normalize_email("not-an-email") is None


def test_account_status_priority_and_unknown():
    assert account_status({"is_activated": True})[0] == "active"
    assert account_status({"is_activated": False})[0] == "inactive"
    assert account_status({"is_activated": True, "is_frozen": True})[0] == "frozen"
    assert account_status({"is_activated": True, "is_resigned": True})[0] == "resigned"
    assert account_status({})[0] == "unknown"
